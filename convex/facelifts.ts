import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const recordResult = mutation({
  args: {
    userId:    v.string(),
    jobId:     v.string(),
    plyS3Key:  v.string(),
    splatS3Key: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("facelifts", {
      userId:    args.userId,
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
