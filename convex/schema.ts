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

  stripeEvents: defineTable({
    eventId: v.string(),
    createdAt: v.number(),
  }).index("by_event_id", ["eventId"]),

  friends: defineTable({
    requesterId: v.id("users"),
    addresseeId: v.id("users"),
    status: v.union(v.literal("pending"), v.literal("accepted")),
    createdAt: v.number(),
    acceptedAt: v.optional(v.number()),
  })
    .index("by_requester_and_addressee", ["requesterId", "addresseeId"])
    .index("by_addressee_and_requester", ["addresseeId", "requesterId"])
    .index("by_requester_and_status", ["requesterId", "status"])
    .index("by_addressee_and_status", ["addresseeId", "status"]),

  messages: defineTable({
    senderId: v.id("users"),
    receiverId: v.id("users"),
    text: v.string(),
    read: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_sender_and_receiver", ["senderId", "receiverId"])
    .index("by_receiver_and_sender", ["receiverId", "senderId"]),

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
