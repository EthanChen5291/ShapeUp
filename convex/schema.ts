import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    clerkId: v.string(),
    email: v.optional(v.string()),
    username: v.optional(v.string()),
    credits: v.number(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_clerk_id", ["clerkId"])
    .index("by_username", ["username"]),

  sessions: defineTable({
    sessionId: v.string(),
    createdAt: v.number(),
    currentProfile: v.optional(v.any()),
    imageUrl: v.optional(v.string()),
    scanS3Key: v.optional(v.string()),
  }).index("by_session_id", ["sessionId"]),

  facelifts: defineTable({
    userId: v.string(),
    jobId: v.string(),
    plyS3Key: v.string(),
    splatS3Key: v.string(),
  })
    .index("by_job_id", ["jobId"])
    .index("by_user_id", ["userId"]),

  waitlist: defineTable({
    email: v.string(),
    notifyOnRelease: v.boolean(),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  projects: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    thumbnailUrl: v.optional(v.string()),
    lastHairParams: v.optional(v.any()),
    lastProfile: v.optional(v.any()),
    lastImageUrl: v.optional(v.string()),
    lastSplatUrl: v.optional(v.string()),
    splatS3Key: v.optional(v.string()),
    savedAt: v.optional(v.number()),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_token_and_updated", ["tokenIdentifier", "updatedAt"]),

});
