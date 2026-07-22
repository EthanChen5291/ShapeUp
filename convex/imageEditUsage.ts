import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

function currentBucket(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Current month's successful image-edit count for operational visibility. */
export const usage = query({
  args: {},
  handler: async (ctx) => {
    const bucket = currentBucket();
    const row = await ctx.db
      .query("imageEditUsage")
      .withIndex("by_bucket", (q) => q.eq("bucket", bucket))
      .unique();
    return { bucket, edits: row?.edits ?? 0 };
  },
});

/** Atomically count one successful edit in the server-selected month. */
export const record = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const bucket = currentBucket();
    const row = await ctx.db
      .query("imageEditUsage")
      .withIndex("by_bucket", (q) => q.eq("bucket", bucket))
      .unique();
    if (row) {
      await ctx.db.patch(row._id, { edits: row.edits + 1 });
    } else {
      await ctx.db.insert("imageEditUsage", { bucket, edits: 1 });
    }
    return null;
  },
});
