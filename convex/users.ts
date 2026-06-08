import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { validateUsernameBusinessRules } from "./lib/contentFilter";
import { enforceMutationRateLimit } from "./lib/rateLimit";

const BIOMETRIC_CONSENT_VERSION = "biometric-notice-2026-06-08";
const USERNAME_CHANGE_LIMIT = 5;
const USERNAME_CHANGE_WINDOW_MS = 60 * 60 * 1000;

export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
  },
});

export const getOrCreate = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (existing) return existing._id;

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
      });
      return pending._id;
    }

    return ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      clerkId: identity.subject,
      email: identity.email,
      username: identity.nickname ?? undefined,
      credits: 0,
    });
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

export const deductCredit = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new Error("User not found — please reload and try again");
    if (user.credits <= 0) throw new Error("No credits remaining");

    await ctx.db.patch(user._id, { credits: user.credits - 1 });
    return user.credits - 1;
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
    if (trimmed.length < 2 || trimmed.length > 20) throw new Error("Username must be 2–20 characters");
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) throw new Error("Username can only contain letters, numbers, and underscores");
    const businessRuleError = validateUsernameBusinessRules(trimmed);
    if (businessRuleError) throw new Error(businessRuleError);

    const existing = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", trimmed))
      .unique();
    if (existing) throw new Error("Username is already taken");

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new Error("User not found");

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

    await ctx.db.delete(user._id);

    return {
      clerkId: user.clerkId,
      s3Keys: [...s3Keys],
      warning: "Legacy session rows without userId cannot be safely attributed for automatic deletion.",
    };
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

export const addCreditsForStripeEvent = internalMutation({
  args: { eventId: v.string(), clerkId: v.string(), amount: v.number() },
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
      await ctx.db.patch(user._id, { credits: user.credits + args.amount });
    } else {
      await ctx.db.insert("users", {
        tokenIdentifier: `pending|${args.clerkId}`,
        clerkId: args.clerkId,
        credits: args.amount,
      });
    }

    return { status: "credited" };
  },
});
