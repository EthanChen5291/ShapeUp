import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const joinWaitlist = mutation({
  args: {
    email: v.string(),
    notifyOnRelease: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("waitlist")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (existing) {
      if (!existing.notifyOnRelease && args.notifyOnRelease) {
        await ctx.db.patch(existing._id, { notifyOnRelease: true });
      }
      return "already_joined";
    }

    await ctx.db.insert("waitlist", {
      email: args.email,
      notifyOnRelease: args.notifyOnRelease,
      createdAt: Date.now(),
    });

    return "joined";
  },
});
