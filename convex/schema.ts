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
    // Monthly free-generation quota: 3/month, reset (not accumulated) each
    // calendar month. freeGenMonthKey is the "YYYY-MM" bucket freeGenUsedInMonth
    // applies to; a stale bucket means nothing's been used yet this month. A
    // per-account counter is only as strong as the cost of a new account, so
    // it's paired with the device/IP signals in freeGenGrants — see
    // convex/freeGen.ts and convex/lib/freeGen.ts.
    freeGenMonthKey: v.optional(v.string()),
    freeGenUsedInMonth: v.optional(v.number()),
    // DEPRECATED: legacy single-use free-gen timestamp, superseded by the
    // monthly quota above. Retained (optional) only so pre-migration user docs
    // still validate; safe to drop once backfilled off every user document.
    freeGenUsedAt: v.optional(v.number()),
    // One-time welcome bundle (WELCOME_BUNDLE_CREDITS) granted at account
    // creation; the timestamp flag makes the grant idempotent across the
    // several getOrCreate paths. See convex/users.ts.
    welcomeGrantedAt: v.optional(v.number()),
    // One-time phone-verification bonus (PHONE_BONUS_CREDITS), granted after a
    // verified phone number is attached via Clerk. Server-verified against
    // Clerk's backend before granting — see src/app/api/phone-bonus/claim.
    phoneBonusGrantedAt: v.optional(v.number()),
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
    // Optional: the raw Gaussian .ply is only uploaded when a caller needs it
    // (e.g. the hair-subtraction flow). The viewer only needs splatS3Key.
    plyS3Key: v.optional(v.string()),
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
    signalType: v.union(v.literal("fingerprint"), v.literal("ip"), v.literal("phone")),
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

  // In-flight 3D renders (the GPU-bound facelift step). One row per active render;
  // the client heartbeats `heartbeatAt` while its render runs and deletes the row
  // when it finishes. The Modal backend caps concurrent GPUs at
  // RENDER_STATION_CAPACITY (server/modal_facelift.py `max_containers`), so once
  // that many rows are live the next render is queued behind them. Ordering the
  // live rows by `_creationTime` (FIFO) lets us tell each client whether it holds
  // a station or is waiting, and at what position. High-churn heartbeats live on
  // their own table (per Convex guidelines) so they don't contend with anything.
  // Stale rows (client crashed / tab closed) stop counting once `heartbeatAt`
  // ages past the liveness window and are reaped opportunistically on claim.
  renderStations: defineTable({
    // Informational link back to the render's session (debugging only).
    sessionId: v.optional(v.string()),
    // Last liveness ping; refreshed by the client every few seconds.
    heartbeatAt: v.number(),
  }).index("by_heartbeat", ["heartbeatAt"]),

  // A barber's public card: /b/<slug>. A free link-in-bio (booking, socials,
  // Venmo/Cash App, call/text, address) whose hero block is a menu of cuts the
  // barber does — tapping one drops the client into the ShapeUp try-on with the
  // barber's referral code attached. The barber is the distributor; their client
  // is the user. See convex/barberPages.ts.
  //
  // `links` and `styles` are capped (MAX_LINKS / MAX_STYLES in
  // convex/lib/barberLinks.ts) so they stay small, bounded arrays — a child
  // table would be overkill for ≤10 rows that are always read together.
  barberPages: defineTable({
    slug: v.string(), // [a-z0-9-]{3,30}, lowercase; unique
    ownerUserId: v.id("users"),
    displayName: v.string(),
    shopName: v.optional(v.string()),
    bio: v.optional(v.string()),
    links: v.array(
      v.object({
        kind: v.string(), // a LinkKind — see convex/lib/barberLinks.ts
        label: v.string(),
        url: v.string(), // normalized + safety-checked at write time
      }),
    ),
    styles: v.array(v.string()), // hairstyle slugs from src/data/hairstyles.ts
    published: v.boolean(),
    // The barber's own inbox — never rendered on the public card. Used only to
    // notify them when a client finishes a try-on. See convex/barberTryOn.ts.
    contactEmail: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Redesign fields — all optional so existing rows stay valid.
    avatarStorageId: v.optional(v.id("_storage")), // barber profile photo
    bannerStorageId: v.optional(v.id("_storage")), // wide cover image behind identity
    location: v.optional(v.string()), // short free-text, e.g. "Telegraph Ave, Oakland"
    hours: v.optional(v.string()), // short free-text, e.g. "Tue–Sat · 9–6"
    services: v.optional(
      v.array(v.object({ name: v.string(), price: v.optional(v.string()) })),
    ), // the barber's service menu
    // Native appointment slots (see convex/lib/bookingSlots.ts). Weekly hours in
    // the barber's own timezone; actual bookings live in barberBookings. `days`
    // is at most 7 entries, so an inline object is fine per the array-size rule.
    booking: v.optional(
      v.object({
        enabled: v.boolean(),
        timezone: v.string(), // IANA zone, validated at write time
        slotMinutes: v.number(), // one of SLOT_MINUTES_OPTIONS
        days: v.array(
          v.object({
            day: v.number(), // 0 (Sun) – 6 (Sat)
            start: v.string(), // "HH:MM", 24h, barber-local
            end: v.string(),
          }),
        ),
      }),
    ),
  })
    .index("by_slug", ["slug"])
    .index("by_owner", ["ownerUserId"]),

  // A client's finished try-on, sent to the barber's chair-side inbox. This row
  // is the durable delivery — the notification email in convex/barberTryOn.ts
  // is best-effort on top, so "send to barber" works even when Resend isn't
  // configured or the barber never added a contact email.
  barberSends: defineTable({
    pageId: v.id("barberPages"),
    cutLabel: v.string(),
    imageUrl: v.string(), // re-hosted in Convex storage by the client before sending
    videoUrl: v.optional(v.string()),
    clientRequest: v.optional(v.string()),
    clientEmail: v.optional(v.string()),
    clientPhone: v.optional(v.string()),
    emailed: v.boolean(),
    createdAt: v.number(),
  }).index("by_page", ["pageId"]),

  // One row per appointment booked through a barber card's native scheduler.
  // Slots are validated against barberPages.booking at write time; a cancelled
  // row keeps its slot history but frees the time. See convex/barberBooking.ts.
  barberBookings: defineTable({
    pageId: v.id("barberPages"),
    startMs: v.number(), // UTC epoch of the slot start
    endMs: v.number(),
    clientUserId: v.id("users"),
    clientName: v.string(),
    clientEmail: v.optional(v.string()),
    clientPhone: v.optional(v.string()),
    service: v.optional(v.string()), // a name from the barber's service menu
    note: v.optional(v.string()),
    status: v.union(v.literal("booked"), v.literal("cancelled")),
    createdAt: v.number(),
  })
    .index("by_page_and_start", ["pageId", "startMs"])
    .index("by_client", ["clientUserId"]),

  // Scan/tap counters for a barber card, in daily buckets ("YYYY-MM-DD").
  // High-churn (every QR scan writes) so it lives off the barberPages doc per
  // the Convex guidelines — a busy Saturday must never contend with an edit.
  // Bucketing keeps rows bounded and lets the barber see a trend, not a total.
  barberPageStats: defineTable({
    pageId: v.id("barberPages"),
    bucket: v.string(),
    views: v.number(),
    tryOns: v.number(),
    linkClicks: v.number(),
    // Redesign counters — optional so existing daily-bucket rows stay valid.
    // Treat missing as 0 everywhere they're read.
    bookingClicks: v.optional(v.number()),
    selfieStarts: v.optional(v.number()),
    previews: v.optional(v.number()),
    byStyle: v.optional(v.record(v.string(), v.number())), // per-hairstyle-slug try-on tap counts
  }).index("by_page_and_bucket", ["pageId", "bucket"]),

  // Inbound messages from the public "Contact us" page. Works for logged-out
  // visitors, so there's no tokenIdentifier — just whatever they typed. A topic
  // routes the message (support / billing / privacy / partnership / press /
  // other). Every submission fans out to Discord — see convex/contact.ts.
  contactMessages: defineTable({
    name: v.string(),
    email: v.string(),
    topic: v.string(),
    message: v.string(),
    // Best-effort context: the Clerk token if the sender happened to be signed
    // in, so we can tie a message back to an account when one exists.
    tokenIdentifier: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

});
