import { internalMutation, mutation, query } from "./_generated/server";
import { ConvexError } from "convex/values";
import { v } from "convex/values";
import { validateUsernameBusinessRules } from "./lib/contentFilter";
import { enforceMutationRateLimit } from "./lib/rateLimit";
import { maybeAttachReferral, uniqueReferralCode } from "./lib/referrals";
import { hairParamsValidator, lastProfileValidator } from "./validators";

// Plan ranking — higher index = more premium. Drives the displayed plan tier.
const PLAN_RANK = ["starter", "popular", "pro"] as const;
type PlanId = (typeof PLAN_RANK)[number];

const BIOMETRIC_CONSENT_VERSION = "biometric-notice-2026-06-08";
const USERNAME_CHANGE_LIMIT = 5;
const USERNAME_CHANGE_WINDOW_MS = 60 * 60 * 1000;

export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;

    // The unused one-time free generation behaves like a trailing credit in the
    // UI: paid credits are always spent first, so `availableGenerations` is what
    // the user can actually run right now. Allowlisted demo accounts bypass
    // billing entirely, so they're effectively unlimited (surfaced as 1 here so
    // gates don't lock them out). See convex/freeGen.ts.
    const freeGenRemaining = user.freeGenUsedAt ? 0 : 1;
    return {
      ...user,
      freeGenRemaining,
      availableGenerations: user.credits + freeGenRemaining,
    };
  },
});

export const getOrCreate = mutation({
  args: { referralCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (existing) {
      // Backfill a referral code for accounts that predate the referral feature.
      if (!existing.referralCode) {
        await ctx.db.patch(existing._id, { referralCode: await uniqueReferralCode(ctx) });
      }
      return existing._id;
    }

    // Check for a pending user created by the webhook before first login
    const pending = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (pending) {
      await ctx.db.patch(pending._id, {
        tokenIdentifier: identity.tokenIdentifier,
        email: identity.email ?? pending.email,
        username: identity.nickname ?? pending.username,
        referralCode: pending.referralCode ?? (await uniqueReferralCode(ctx)),
      });
      await maybeAttachReferral(ctx, pending._id, args.referralCode);
      return pending._id;
    }

    const userId = await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      clerkId: identity.subject,
      email: identity.email,
      username: identity.nickname ?? undefined,
      credits: 0,
      referralCode: await uniqueReferralCode(ctx),
    });
    await maybeAttachReferral(ctx, userId, args.referralCode);
    return userId;
  },
});

export const getReferralStats = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;

    const referrals = await ctx.db
      .query("referrals")
      .withIndex("by_referrer", (q) => q.eq("referrerUserId", user._id))
      .take(500);
    const rewarded = referrals.filter((r) => r.status === "rewarded").length;
    const pending = referrals.length - rewarded;

    return {
      referralCode: user.referralCode ?? null,
      friendsJoined: referrals.length,
      friendsRewarded: rewarded,
      friendsPending: pending,
      tokensEarned: rewarded * 3,
    };
  },
});

export const hasBiometricConsent = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    return Boolean(user?.biometricConsentAt);
  },
});

// Confirms the signed-in user owns a given S3 image key. Used by /api/img to
// gate access to sensitive per-user assets (scans / edited face images) so a
// leaked or guessed key can't be fetched by another account. Checks the user's
// own sessions, projects, and saved defaultScan — all keys the user legitimately
// references. Returns false for anyone else (and the unauthenticated case).
export const ownsImageKey = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;
    const token = identity.tokenIdentifier;

    // Sessions (raw scan uploads) — indexed by owner.
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_id", (q) => q.eq("userId", token))
      .collect();
    if (sessions.some((s) => s.scanS3Key === key || s.imageUrl === key)) return true;

    // Projects (snapshots: scan + edit image + thumbnail) — indexed by owner.
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", token))
      .collect();
    if (
      projects.some(
        (p) =>
          p.lastImageS3Key === key ||
          p.lastEditImageS3Key === key ||
          p.thumbnailS3Key === key,
      )
    ) {
      return true;
    }

    // The reusable default scan stored on the user doc.
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", token))
      .unique();
    const ds = user?.defaultScan;
    if (ds && (ds.lastImageS3Key === key || ds.thumbnailS3Key === key)) return true;

    return false;
  },
});

export const recordBiometricConsent = mutation({
  args: { noticeVersion: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    let user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!user) {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: identity.tokenIdentifier,
        clerkId: identity.subject,
        email: identity.email,
        username: identity.nickname ?? undefined,
        credits: 0,
      });
      user = await ctx.db.get(userId);
    }
    if (!user) throw new Error("User not found");

    const consentAt = Date.now();
    await ctx.db.patch(user._id, {
      biometricConsentAt: consentAt,
      biometricConsentVersion: args.noticeVersion ?? BIOMETRIC_CONSENT_VERSION,
    });
    return { consentAt };
  },
});

// Records the user's answer to the one-time "Improve ShapeUp?" prompt. Stamping
// promptedAt (even on decline) is what guarantees the prompt only ever shows once.
export const setImproveShapeUp = mutation({
  args: { optIn: v.boolean() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new Error("User not found");

    await ctx.db.patch(user._id, {
      improveShapeUpOptIn: args.optIn,
      improveShapeUpPromptedAt: Date.now(),
    });
  },
});

function getBypassEmails(): Set<string> {
  return new Set(
    (process.env.DEMO_BYPASS_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * True when the signed-in account is on the demo/dev email allowlist.
 * Falls back to the JWT email claim so it works even before the `users`
 * row has its email backfilled (otherwise allowlisted users with no
 * credits get charged + paywalled despite being on the list).
 */
function isOnEmailAllowlist(
  user: { email?: string } | null,
  identity: { email?: string | null },
): boolean {
  const email = user?.email ?? identity.email ?? undefined;
  return Boolean(email && getBypassEmails().has(email.toLowerCase()));
}

export const deductCredit = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError("Couldn't find your account. Please reload and try again.");

    // Dev/demo allowlist: bypass the paywall entirely for allowlisted emails,
    // even when they have no credits.
    if (isOnEmailAllowlist(user, identity)) {
      return user.credits;
    }

    if (user.credits <= 0) throw new ConvexError("You're out of credits. Add more to continue.");

    await ctx.db.patch(user._id, { credits: user.credits - 1 });
    return user.credits - 1;
  },
});

/** True when the current user is an allowlisted demo/dev account. */
export const isAllowlisted = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    return isOnEmailAllowlist(user, identity);
  },
});

export const setUsername = mutation({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    await enforceMutationRateLimit(
      ctx,
      `users:setUsername:${identity.tokenIdentifier}`,
      USERNAME_CHANGE_LIMIT,
      USERNAME_CHANGE_WINDOW_MS,
    );

    const trimmed = args.username.trim();
    if (trimmed.length < 2 || trimmed.length > 20) throw new ConvexError("Username must be between 2 and 20 characters.");
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) throw new ConvexError("Only letters, numbers, and underscores are allowed.");
    const businessRuleError = validateUsernameBusinessRules(trimmed);
    if (businessRuleError) throw new ConvexError(businessRuleError);

    const existing = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", trimmed))
      .unique();
    if (existing) throw new ConvexError("That username is already taken. Try another one.");

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError("Couldn't find your account. Try signing out and back in.");

    await ctx.db.patch(user._id, { username: trimmed });
    return trimmed;
  },
});

function pushKey(keys: Set<string>, value: unknown) {
  if (typeof value !== "string") return;
  if (value.startsWith("pictures/") || value.startsWith("facelifts/") || value.startsWith("projects/")) {
    keys.add(value);
  }
}

export const deleteCurrentUserData = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new Error("User not found");

    await ctx.db.insert("accountDeletionRequests", {
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      requestedAt: Date.now(),
      status: "processing",
    });

    const s3Keys = new Set<string>();

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_id", (q) => q.eq("userId", identity.tokenIdentifier))
      .take(200);
    for (const session of sessions) {
      pushKey(s3Keys, session.scanS3Key);
      pushKey(s3Keys, session.imageUrl);
      await ctx.db.delete(session._id);
    }

    const facelifts = await ctx.db
      .query("facelifts")
      .withIndex("by_user_id", (q) => q.eq("userId", identity.tokenIdentifier))
      .take(200);
    for (const facelift of facelifts) {
      pushKey(s3Keys, facelift.plyS3Key);
      pushKey(s3Keys, facelift.splatS3Key);
      await ctx.db.delete(facelift._id);
    }

    const projects = await ctx.db
      .query("projects")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .take(200);
    for (const project of projects) {
      pushKey(s3Keys, project.splatS3Key);
      pushKey(s3Keys, project.thumbnailUrl);
      pushKey(s3Keys, project.lastImageUrl);
      pushKey(s3Keys, project.lastSplatUrl);
      await ctx.db.delete(project._id);
    }

    if (user.defaultScan) {
      pushKey(s3Keys, user.defaultScan.lastImageS3Key);
      pushKey(s3Keys, user.defaultScan.lastImageUrl);
      pushKey(s3Keys, user.defaultScan.splatS3Key);
      pushKey(s3Keys, user.defaultScan.lastSplatUrl);
    }

    await ctx.db.delete(user._id);

    return {
      clerkId: user.clerkId,
      s3Keys: [...s3Keys],
      warning: "Legacy session rows without userId cannot be safely attributed for automatic deletion.",
    };
  },
});

export const updateSettings = mutation({
  args: {
    theme: v.optional(v.union(v.literal("light"), v.literal("dark"), v.literal("system"))),
    renderQuality: v.optional(v.union(v.literal("performance"), v.literal("balanced"), v.literal("high"))),
    aiTrainingOptOut: v.optional(v.boolean()),
    language: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new Error("User not found");
    const patch: Record<string, unknown> = {};
    if (args.theme !== undefined) patch.theme = args.theme;
    if (args.renderQuality !== undefined) patch.renderQuality = args.renderQuality;
    if (args.aiTrainingOptOut !== undefined) patch.aiTrainingOptOut = args.aiTrainingOptOut;
    if (args.language !== undefined) patch.language = args.language;
    await ctx.db.patch(user._id, patch);
  },
});

// Records the user's latest completed scan as the reusable "default scan".
// Called after a real scan+3D build finishes. Projects copy these keys at
// creation (snapshot), so overwriting this never touches existing projects.
export const setDefaultScan = mutation({
  args: {
    lastImageS3Key: v.optional(v.string()),
    lastImageUrl: v.optional(v.string()),
    thumbnailS3Key: v.optional(v.string()),
    splatS3Key: v.optional(v.string()),
    lastSplatUrl: v.optional(v.string()),
    lastProfile: v.optional(lastProfileValidator),
    lastHairParams: v.optional(hairParamsValidator),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new Error("User not found");
    await ctx.db.patch(user._id, {
      defaultScan: { ...args, updatedAt: Date.now() },
    });
  },
});

export const revokeBiometricConsent = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new Error("User not found");

    // Revoking consent must delete the raw facial scans (the biometric identifier).
    // Generated 3D models are kept. The S3 objects themselves are deleted by the
    // calling API route using the keys returned below (Convex can't reach S3 directly).
    const s3Keys = new Set<string>();
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_id", (q) => q.eq("userId", identity.tokenIdentifier))
      .take(200);
    for (const session of sessions) {
      pushKey(s3Keys, session.scanS3Key);
      pushKey(s3Keys, session.imageUrl);
      await ctx.db.delete(session._id);
    }

    // The reusable default scan caches the raw scan image key — drop it (and queue
    // it for S3 deletion) so revocation doesn't leave a biometric pointer behind.
    if (user.defaultScan) {
      pushKey(s3Keys, user.defaultScan.lastImageS3Key);
      pushKey(s3Keys, user.defaultScan.lastImageUrl);
    }

    await ctx.db.patch(user._id, {
      biometricConsentAt: undefined,
      biometricConsentVersion: undefined,
      defaultScan: undefined,
    });

    return { s3Keys: [...s3Keys] };
  },
});

export const addCredits = internalMutation({
  args: { clerkId: v.string(), amount: v.number() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    if (user) {
      await ctx.db.patch(user._id, { credits: user.credits + args.amount });
    } else {
      await ctx.db.insert("users", {
        tokenIdentifier: `pending|${args.clerkId}`,
        clerkId: args.clerkId,
        credits: args.amount,
      });
    }
  },
});

/** Returns the higher-ranked of two plan ids (or the defined one). */
function higherPlan(a: PlanId | undefined, b: PlanId | undefined): PlanId | undefined {
  if (!a) return b;
  if (!b) return a;
  return PLAN_RANK.indexOf(a) >= PLAN_RANK.indexOf(b) ? a : b;
}

export const addCreditsForStripeEvent = internalMutation({
  args: {
    eventId: v.string(),
    clerkId: v.string(),
    amount: v.number(),
    plan: v.optional(v.union(v.literal("starter"), v.literal("popular"), v.literal("pro"))),
  },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.amount) || args.amount <= 0) {
      throw new Error("Invalid credit amount");
    }

    const existingEvent = await ctx.db
      .query("stripeEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (existingEvent) return { status: "duplicate" };

    await ctx.db.insert("stripeEvents", {
      eventId: args.eventId,
      createdAt: Date.now(),
    });

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    if (user) {
      await ctx.db.patch(user._id, {
        credits: user.credits + args.amount,
        topPlan: higherPlan(user.topPlan, args.plan),
      });
    } else {
      await ctx.db.insert("users", {
        tokenIdentifier: `pending|${args.clerkId}`,
        clerkId: args.clerkId,
        credits: args.amount,
        topPlan: args.plan,
      });
    }

    return { status: "credited" };
  },
});
