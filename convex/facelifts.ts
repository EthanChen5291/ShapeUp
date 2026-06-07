import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const recordResult = mutation({
  args: {
    jobId:     v.string(),
    plyS3Key:  v.string(),
    splatS3Key: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    await ctx.db.insert("facelifts", {
      userId:    identity.tokenIdentifier,
      jobId:     args.jobId,
      plyS3Key:  args.plyS3Key,
      splatS3Key: args.splatS3Key,
    });
  },
});

export const getByJobId = query({
  args: { jobId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("facelifts")
      .withIndex("by_job_id", q => q.eq("jobId", args.jobId))
      .unique();
  },
});

export const getLatestByUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return ctx.db
      .query("facelifts")
      .withIndex("by_user_id", q => q.eq("userId", identity.tokenIdentifier))
      .order("desc")
      .first();
  },
});
