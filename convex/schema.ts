import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    clerkId: v.string(),
    email: v.optional(v.string()),
    username: v.optional(v.string()),
    credits: v.number(),
    biometricConsentAt: v.optional(v.number()),
    biometricConsentVersion: v.optional(v.string()),
    theme: v.optional(v.union(v.literal("light"), v.literal("dark"), v.literal("system"))),
    renderQuality: v.optional(v.union(v.literal("performance"), v.literal("balanced"), v.literal("high"))),
    aiTrainingOptOut: v.optional(v.boolean()),
    language: v.optional(v.string()),
    // Each user's own shareable referral code.
    referralCode: v.optional(v.string()),
    // The referral code this user signed up under (set once, at creation).
    referredBy: v.optional(v.string()),
    // Highest-ranked plan ever purchased; drives the displayed plan tier.
    topPlan: v.optional(v.union(v.literal("starter"), v.literal("popular"), v.literal("lifetime"))),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_clerk_id", ["clerkId"])
    .index("by_username", ["username"])
    .index("by_referral_code", ["referralCode"]),

  // One row per referral relationship. Reward is granted when the referred
  // user creates their first project (status flips pending -> rewarded).
  referrals: defineTable({
    referrerUserId: v.id("users"),
    referredUserId: v.id("users"),
    referrerCode: v.string(),
    status: v.union(v.literal("pending"), v.literal("rewarded")),
    createdAt: v.number(),
    rewardedAt: v.optional(v.number()),
  })
    .index("by_referred", ["referredUserId"])
    .index("by_referrer", ["referrerUserId"]),

  // Custom redeemable token codes (separate from Stripe promo codes).
  redeemCodes: defineTable({
    code: v.string(),
    tokens: v.number(),
    maxUses: v.optional(v.number()), // undefined = unlimited
    usedCount: v.number(),
    expiresAt: v.optional(v.number()),
    active: v.boolean(),
  }).index("by_code", ["code"]),

  // One row per (user, code) to prevent the same user redeeming a code twice.
  redeemRedemptions: defineTable({
    userId: v.id("users"),
    code: v.string(),
    tokens: v.number(),
    redeemedAt: v.number(),
  }).index("by_user_and_code", ["userId", "code"]),

  sessions: defineTable({
    userId: v.optional(v.string()),
    sessionId: v.string(),
    createdAt: v.number(),
    currentProfile: v.optional(v.any()),
    imageUrl: v.optional(v.string()),
    scanS3Key: v.optional(v.string()),
  })
    .index("by_session_id", ["sessionId"])
    .index("by_user_id", ["userId"]),

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

  accountDeletionRequests: defineTable({
    requestId: v.string(),
    requestedAt: v.number(),
    status: v.union(v.literal("processing"), v.literal("completed"), v.literal("failed")),
  }).index("by_request_id", ["requestId"]),

  rateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),

  // Denormalized GPU-seconds counter, one row per monthly bucket ("YYYY-MM").
  // Used to cap demo Modal spend — see convex/gpuUsage.ts.
  gpuUsage: defineTable({
    bucket: v.string(),
    seconds: v.number(),
  }).index("by_bucket", ["bucket"]),

  projects: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    thumbnailUrl: v.optional(v.string()),
    thumbnailS3Key: v.optional(v.string()),
    thumbnailStorageId: v.optional(v.id("_storage")),
    lastHairParams: v.optional(v.any()),
    lastProfile: v.optional(v.any()),
    lastImageUrl: v.optional(v.string()),
    lastImageS3Key: v.optional(v.string()),
    lastEditImageS3Key: v.optional(v.string()),
    lastSplatUrl: v.optional(v.string()),
    splatS3Key: v.optional(v.string()),
    savedAt: v.optional(v.number()),
    bgBrightness: v.optional(v.number()),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_token_and_updated", ["tokenIdentifier", "updatedAt"]),

});
