import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireConvexAdmin } from "./lib/adminAuth";

export const create = mutation({
  args: {
    sessionId: v.string(),
    currentProfile: v.optional(v.any()),
    imageUrl: v.optional(v.string()),
    scanS3Key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    return await ctx.db.insert("sessions", {
      ...args,
      userId: identity.tokenIdentifier,
      createdAt: Date.now(),
    });
  },
});

// Admin: most recent sessions across all users. The /api/admin-sessions route
// also restricts callers to admins; this enforces it independently.
export const listRecent = query({
  args: {},
  handler: async (ctx) => {
    await requireConvexAdmin(ctx);

    return await ctx.db.query("sessions").order("desc").take(50);
  },
});
