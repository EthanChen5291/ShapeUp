import { internalMutation, mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { hairParamsValidator, lastProfileValidator } from "./validators";
import { grantReferralReward } from "./lib/referrals";

export const MAX_PROJECTS_PER_USER = 5;

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
    return Promise.all(rows.map(async ({ _id, _creationTime, name, thumbnailS3Key, thumbnailStorageId, createdAt, updatedAt, savedAt, lastAccessedAt, splatS3Key }) => {
      // Resolve thumbnail: S3 key is served fresh via /api/img on the client;
      // Convex storageId is resolved here at query time so the URL is always valid.
      // Old thumbnailUrl (stored time-limited URL) is intentionally omitted.
      const thumbnailUrl = !thumbnailS3Key && thumbnailStorageId
        ? (await ctx.storage.getUrl(thumbnailStorageId)) ?? undefined
        : undefined;
      return { _id, _creationTime, name, thumbnailUrl, thumbnailS3Key, createdAt, updatedAt, savedAt, lastAccessedAt, splatS3Key };
    }));
  },
});

export const create = mutation({
  // seedFromDefaultScan: copy the user's saved scan (image/splat/profile) into the
  // new project so it opens straight into the studio with no re-scan or GPU build.
  // The copy lives on the project, so later edits to the default scan don't touch it.
  args: { name: v.string(), seedFromDefaultScan: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .take(MAX_PROJECTS_PER_USER + 1);
    if (existing.length >= MAX_PROJECTS_PER_USER) {
      throw new ConvexError(
        `You've reached the limit of ${MAX_PROJECTS_PER_USER} projects. Delete one to make room for a new cut.`,
      );
    }
    const isFirstProject = existing.length === 0;
    const now = Date.now();

    let seed: Record<string, unknown> = {};
    if (args.seedFromDefaultScan) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
        .unique();
      const ds = user?.defaultScan;
      if (ds) {
        seed = {
          lastImageS3Key: ds.lastImageS3Key,
          lastImageUrl: ds.lastImageUrl,
          thumbnailS3Key: ds.thumbnailS3Key,
          splatS3Key: ds.splatS3Key,
          lastSplatUrl: ds.lastSplatUrl,
          lastProfile: ds.lastProfile,
          lastHairParams: ds.lastHairParams,
        };
      }
    }

    const projectId = await ctx.db.insert("projects", {
      tokenIdentifier: identity.tokenIdentifier,
      name: args.name,
      createdAt: now,
      updatedAt: now,
      ...seed,
    });

    // A referred user's first project unlocks the referral reward for both parties.
    if (isFirstProject) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
        .unique();
      if (user) await grantReferralReward(ctx, user._id);
    }

    return projectId;
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
    lastEditImageS3Key: v.optional(v.string()),
    lastSplatUrl: v.optional(v.string()),
    splatS3Key: v.optional(v.string()),
    bgBrightness: v.optional(v.number()),
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

export const rename = mutation({
  args: { projectId: v.id("projects"), name: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Not found");
    }
    await ctx.db.patch(args.projectId, { name: args.name, updatedAt: Date.now() });
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

// Records that a project was opened, so the dashboard's "recent" tab can sort
// by most-recently-accessed. Persisted server-side, so the order survives refresh.
export const markAccessed = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Not found");
    }
    await ctx.db.patch(args.projectId, { lastAccessedAt: Date.now() });
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
    // Store the storageId — never the URL. URL is resolved fresh in the list query.
    await ctx.db.patch(args.projectId, {
      thumbnailStorageId: args.storageId,
      thumbnailUrl: undefined,
      updatedAt: Date.now(),
    });
  },
});

// One-time migration: backfill lastImageS3Key for records that have only lastImageUrl.
// Presigned S3 URLs embed the key in the path: https://BUCKET.s3.REGION.amazonaws.com/KEY?...
export const migrateLastImageUrls = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("projects").collect();
    let migrated = 0;
    for (const row of rows) {
      if (!row.lastImageUrl || row.lastImageS3Key) continue;
      try {
        const pathname = new URL(row.lastImageUrl).pathname.slice(1); // strip leading /
        if (pathname.startsWith("pictures/")) {
          await ctx.db.patch(row._id, { lastImageS3Key: pathname });
          migrated++;
        }
      } catch {
        // skip malformed URLs
      }
    }
    return { migrated };
  },
});
