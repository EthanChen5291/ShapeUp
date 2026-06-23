import { mutation, query, internalAction } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireConvexAdmin } from "./lib/adminAuth";

const MAX_REASON_LENGTH = 1000;
const DEFAULT_REFUND_TOKENS = 1;

async function currentUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

// Raised from the studio when a user isn't satisfied with a generated model.
// The selfie + splat S3 keys are read server-side from the project (never the
// client) so the snapshot an admin reviews can't be tampered with. The selfie /
// splat *presigned* URLs are passed through from the Next.js route (S3 signing
// lives there) purely so the Discord ping can embed them — we don't store them.
export const submitRequest = mutation({
  args: {
    projectId: v.id("projects"),
    reason: v.optional(v.string()),
    // Presigned, short-lived URLs for the Discord embed only.
    selfieUrl: v.optional(v.string()),
    splatUrl: v.optional(v.string()),
    adminUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Project not found");
    }

    const projectId = String(args.projectId);

    // One open request per project — re-asking just no-ops so a frustrated user
    // tapping twice doesn't spam Discord or stack duplicate rows.
    const existingPending = await ctx.db
      .query("refundRequests")
      .withIndex("by_token_and_project", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier).eq("projectId", projectId),
      )
      .collect();
    if (existingPending.some((r) => r.status === "pending")) {
      return { ok: true, deduped: true };
    }

    const reason = args.reason?.trim().slice(0, MAX_REASON_LENGTH) || undefined;
    const user = await currentUser(ctx);
    const now = Date.now();

    const selfieS3Key =
      (project as { lastEditImageS3Key?: string }).lastEditImageS3Key ??
      (project as { lastImageS3Key?: string }).lastImageS3Key;
    const splatS3Key = (project as { splatS3Key?: string }).splatS3Key;

    await ctx.db.insert("refundRequests", {
      tokenIdentifier: identity.tokenIdentifier,
      projectId,
      reason,
      selfieS3Key,
      splatS3Key,
      email: user?.email ?? identity.email ?? undefined,
      username: user?.username,
      status: "pending",
      createdAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.refunds.notifyDiscord, {
      reason,
      selfieUrl: args.selfieUrl,
      splatUrl: args.splatUrl,
      adminUrl: args.adminUrl,
      email: user?.email ?? identity.email ?? undefined,
      username: user?.username,
    });

    return { ok: true, deduped: false };
  },
});

// Fan-out to Discord. Runs out-of-band so a webhook hiccup never blocks the
// user's request. Mirrors feedback.notifyDiscord.
export const notifyDiscord = internalAction({
  args: {
    reason: v.optional(v.string()),
    selfieUrl: v.optional(v.string()),
    splatUrl: v.optional(v.string()),
    adminUrl: v.optional(v.string()),
    email: v.optional(v.string()),
    username: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const webhookUrl = process.env.DISCORD_REFUND_WEBHOOK_URL;
    if (!webhookUrl) {
      console.warn("[refunds] DISCORD_REFUND_WEBHOOK_URL not set — skipping alert");
      return null;
    }

    const who = args.username || args.email || "anonymous";
    const links: string[] = [];
    if (args.splatUrl) links.push(`[Download .splat](${args.splatUrl})`);
    if (args.adminUrl) links.push(`[Verify in admin](${args.adminUrl})`);

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "ShapeUp Refunds",
        embeds: [
          {
            title: "Token refund requested",
            description: args.reason || "_no reason left_",
            color: 0xe0a106, // amber — needs a human to look
            ...(args.selfieUrl ? { image: { url: args.selfieUrl } } : {}),
            fields: [
              { name: "User", value: who, inline: true },
              ...(links.length ? [{ name: "Review", value: links.join(" · "), inline: false }] : []),
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });

    if (!res.ok) {
      console.error("[refunds] Discord webhook failed:", res.status, await res.text().catch(() => ""));
    }
    return null;
  },
});

// Admin: most recent refund requests, newest first. The /api/admin-refunds route
// also restricts callers to admins; this enforces it independently.
export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireConvexAdmin(ctx);
    const limit = Math.min(args.limit ?? 100, 500);
    return await ctx.db.query("refundRequests").order("desc").take(limit);
  },
});

// Admin: approve (grant tokens) or deny a pending request. Only acts on pending
// rows, so re-clicking can never double-refund.
export const resolve = mutation({
  args: {
    requestId: v.id("refundRequests"),
    action: v.union(v.literal("approve"), v.literal("deny")),
    tokens: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireConvexAdmin(ctx);

    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Request not found");
    if (request.status !== "pending") throw new Error("Request already resolved");

    const now = Date.now();

    if (args.action === "deny") {
      await ctx.db.patch(request._id, { status: "denied", resolvedAt: now });
      return { ok: true, status: "denied" as const };
    }

    const tokens = Math.round(args.tokens ?? DEFAULT_REFUND_TOKENS);
    if (!Number.isFinite(tokens) || tokens <= 0) {
      throw new Error("Refund amount must be a positive number");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", request.tokenIdentifier))
      .unique();
    if (!user) throw new Error("User no longer exists");

    await ctx.db.patch(user._id, { credits: user.credits + tokens });
    await ctx.db.patch(request._id, {
      status: "approved",
      resolvedAt: now,
      refundedTokens: tokens,
    });

    return { ok: true, status: "approved" as const, refundedTokens: tokens, credits: user.credits + tokens };
  },
});
