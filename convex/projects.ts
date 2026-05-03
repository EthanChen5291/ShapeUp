import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return ctx.db
      .query("projects")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .order("desc")
      .take(50);
  },
});

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const now = Date.now();
    return ctx.db.insert("projects", {
      tokenIdentifier: identity.tokenIdentifier,
      name: args.name,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const save = mutation({
  args: {
    projectId: v.id("projects"),
    thumbnailUrl: v.optional(v.string()),
    lastHairParams: v.optional(v.any()),
    lastProfile: v.optional(v.any()),
    lastImageUrl: v.optional(v.string()),
    lastSplatUrl: v.optional(v.string()),
    splatS3Key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Not found");
    }
    const { projectId, ...fields } = args;
    await ctx.db.patch(projectId, { ...fields, updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Not found");
    }
    await ctx.db.delete(args.projectId);
  },
});
