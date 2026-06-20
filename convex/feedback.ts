import { mutation, query, internalAction } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireConvexAdmin } from "./lib/adminAuth";

// How long we wait before re-asking the same user, after a submission or a
// dismissal. The client also suppresses a re-prompt within the same session.
const FEEDBACK_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_COMMENT_LENGTH = 2000;
const LOW_RATING_THRESHOLD = 2; // ratings <= this fan out to Discord

async function currentUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

// Admin: most recent feedback, newest first. Enforces admin directly (in
// addition to the /api/admin-feedback route's own check).
export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireConvexAdmin(ctx);
    const limit = Math.min(args.limit ?? 100, 500);
    return await ctx.db.query("feedback").order("desc").take(limit);
  },
});

// Throttle state the client uses to decide whether to surface the star toast.
export const getFeedbackState = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return { eligible: false, lastPromptAt: null, lastSubmittedAt: null };
    const last = Math.max(user.lastFeedbackPromptAt ?? 0, user.lastFeedbackSubmittedAt ?? 0);
    return {
      eligible: Date.now() - last > FEEDBACK_COOLDOWN_MS,
      lastPromptAt: user.lastFeedbackPromptAt ?? null,
      lastSubmittedAt: user.lastFeedbackSubmittedAt ?? null,
    };
  },
});

// Records that the toast was shown (incl. dismissal) so the cooldown starts
// ticking even when the user doesn't submit.
export const markPrompted = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    await ctx.db.patch(user._id, { lastFeedbackPromptAt: Date.now() });
    return null;
  },
});

export const submitFeedback = mutation({
  args: {
    rating: v.number(),
    comment: v.optional(v.string()),
    route: v.optional(v.string()),
    projectId: v.optional(v.string()),
    editCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const rating = Math.round(args.rating);
    if (rating < 1 || rating > 5) throw new Error("Rating must be between 1 and 5");
    const comment = args.comment?.trim().slice(0, MAX_COMMENT_LENGTH) || undefined;

    const user = await currentUser(ctx);
    const now = Date.now();

    await ctx.db.insert("feedback", {
      tokenIdentifier: identity.tokenIdentifier,
      rating,
      comment,
      route: args.route,
      projectId: args.projectId,
      editCount: args.editCount,
      email: user?.email ?? identity.email ?? undefined,
      username: user?.username,
      createdAt: now,
    });

    if (user) {
      await ctx.db.patch(user._id, { lastFeedbackSubmittedAt: now, lastFeedbackPromptAt: now });
    }

    // Low scores ping Discord in real time; high scores just sit in the table.
    if (rating <= LOW_RATING_THRESHOLD) {
      await ctx.scheduler.runAfter(0, internal.feedback.notifyDiscord, {
        rating,
        comment,
        route: args.route,
        projectId: args.projectId,
        email: user?.email ?? identity.email ?? undefined,
        username: user?.username,
      });
    }

    return { ok: true };
  },
});

// Fan-out to Discord for low ratings. Runs out-of-band so a webhook hiccup
// never blocks the user's submission.
export const notifyDiscord = internalAction({
  args: {
    rating: v.number(),
    comment: v.optional(v.string()),
    route: v.optional(v.string()),
    projectId: v.optional(v.string()),
    email: v.optional(v.string()),
    username: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const webhookUrl = process.env.DISCORD_FEEDBACK_WEBHOOK_URL;
    if (!webhookUrl) {
      console.warn("[feedback] DISCORD_FEEDBACK_WEBHOOK_URL not set — skipping alert");
      return null;
    }

    const stars = "★".repeat(args.rating) + "☆".repeat(5 - args.rating);
    const who = args.username || args.email || "anonymous";

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "ShapeUp Feedback",
        embeds: [
          {
            title: `${stars}  (${args.rating}/5)`,
            description: args.comment || "_no comment left_",
            color: 0xd64545, // red-ish — this is a low score
            fields: [
              { name: "User", value: who, inline: true },
              { name: "Surface", value: args.route || "unknown", inline: true },
              ...(args.projectId ? [{ name: "Project", value: args.projectId, inline: true }] : []),
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });

    if (!res.ok) {
      console.error("[feedback] Discord webhook failed:", res.status, await res.text().catch(() => ""));
    }
    return null;
  },
});
