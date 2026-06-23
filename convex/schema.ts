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
    // Optional product-analytics opt-in ("Improve ShapeUp?"). PromptedAt records
    // that the one-time dashboard prompt was shown (so it never shows twice);
    // OptIn is the user's choice. Anonymous usage data only — never scan/face data.
    improveShapeUpOptIn: v.optional(v.boolean()),
    improveShapeUpPromptedAt: v.optional(v.number()),
    theme: v.optional(v.union(v.literal("light"), v.literal("dark"), v.literal("system"))),
    renderQuality: v.optional(v.union(v.literal("performance"), v.literal("balanced"), v.literal("high"))),
    aiTrainingOptOut: v.optional(v.boolean()),
    language: v.optional(v.string()),
    // Each user's own shareable referral code.
    referralCode: v.optional(v.string()),
    // The referral code this user signed up under (set once, at creation).
    referredBy: v.optional(v.string()),
    // Highest-ranked plan ever purchased; drives the displayed plan tier.
    topPlan: v.optional(v.union(v.literal("starter"), v.literal("popular"), v.literal("pro"))),
    // When this account consumed its one-time free generation. A per-account
    // flag is only as strong as the cost of a new account, so it's paired with
    // the device/IP signals in freeGenGrants — see convex/freeGen.ts.
    freeGenUsedAt: v.optional(v.number()),
    // Feedback-prompt throttling. Prompted = last time the star toast was shown
    // (incl. dismissals); Submitted = last time a rating was actually sent.
    lastFeedbackPromptAt: v.optional(v.number()),
    lastFeedbackSubmittedAt: v.optional(v.number()),
    // The user's most recent completed scan, kept as a reusable "source" so a new
    // project can be spun up without re-capturing + rebuilding the same head.
    // Projects SNAPSHOT (copy) these keys at creation — see projects.create
    // ({ seedFromDefaultScan }) — so updating this later never mutates existing
    // projects. Fields mirror the projects table (v.any() for profile/params).
    defaultScan: v.optional(
      v.object({
        lastImageS3Key: v.optional(v.string()),
        lastImageUrl: v.optional(v.string()),
        thumbnailS3Key: v.optional(v.string()),
        splatS3Key: v.optional(v.string()),
        lastSplatUrl: v.optional(v.string()),
        lastProfile: v.optional(v.any()),
        lastHairParams: v.optional(v.any()),
        updatedAt: v.number(),
      }),
    ),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_clerk_id", ["clerkId"])
    .index("by_username", ["username"])
    .index("by_email", ["email"])
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

  // Permanent ledger of free-generation grants, keyed by an anti-Sybil signal
  // (a hashed device fingerprint or hashed IP). Lets us cap free GPU runs per
  // physical device / network even when a user spins up many accounts.
  // See convex/freeGen.ts.
  freeGenGrants: defineTable({
    signalType: v.union(v.literal("fingerprint"), v.literal("ip")),
    signalHash: v.string(),
    userId: v.id("users"),
    grantedAt: v.number(),
  }).index("by_signal", ["signalType", "signalHash"]),

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
    lastAccessedAt: v.optional(v.number()),
    bgBrightness: v.optional(v.number()),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_token_and_updated", ["tokenIdentifier", "updatedAt"]),

  // In-product satisfaction ratings (1–5 stars + optional note), solicited at
  // success moments in the studio. ≤2★ fans out to Discord — see feedback.ts.
  feedback: defineTable({
    tokenIdentifier: v.string(),
    rating: v.number(), // 1–5
    comment: v.optional(v.string()),
    route: v.optional(v.string()), // surface that triggered the prompt
    projectId: v.optional(v.string()),
    editCount: v.optional(v.number()), // completed edits this session
    email: v.optional(v.string()),
    username: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_rating", ["rating"]),

  // Token-refund requests, raised from the studio when a user isn't happy with a
  // generated model (face drift, etc.). Each row snapshots the selfie + splat S3
  // keys so an admin can verify the output well after the fact. New requests fan
  // out to Discord (selfie inline + splat link) — see convex/refunds.ts. Status
  // moves pending -> approved (tokens granted) | denied.
  refundRequests: defineTable({
    tokenIdentifier: v.string(),
    projectId: v.optional(v.string()),
    reason: v.optional(v.string()),
    selfieS3Key: v.optional(v.string()),
    splatS3Key: v.optional(v.string()),
    email: v.optional(v.string()),
    username: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("denied")),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
    refundedTokens: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_token", ["tokenIdentifier"])
    .index("by_token_and_project", ["tokenIdentifier", "projectId"]),

});
