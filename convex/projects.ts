import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { hairParamsValidator, lastProfileValidator } from "./validators";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("projects")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .order("desc")
      .take(50);
    return rows.map(({ _id, _creationTime, name, thumbnailUrl, thumbnailS3Key, createdAt, updatedAt, savedAt, splatS3Key }) => ({
      _id, _creationTime, name, thumbnailUrl, thumbnailS3Key, createdAt, updatedAt, savedAt, splatS3Key,
    }));
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
    thumbnailS3Key: v.optional(v.string()),
    lastHairParams: v.optional(hairParamsValidator),
    lastProfile: v.optional(lastProfileValidator),
    lastImageUrl: v.optional(v.string()),
    lastImageS3Key: v.optional(v.string()),
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

export const toggleSave = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Not found");
    }
    await ctx.db.patch(args.projectId, {
      savedAt: project.savedAt ? undefined : Date.now(),
    });
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

export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) return null;
    return project;
  },
});

export const generateThumbnailUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return ctx.storage.generateUploadUrl();
  },
});

export const saveThumbnail = mutation({
  args: { projectId: v.id("projects"), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) throw new Error("Not found");
    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) throw new Error("Storage URL not available");
    await ctx.db.patch(args.projectId, { thumbnailUrl: url, updatedAt: Date.now() });
  },
});
