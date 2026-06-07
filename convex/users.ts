import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";

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

    const trimmed = args.username.trim();
    if (trimmed.length < 2 || trimmed.length > 20) throw new Error("Username must be 2–20 characters");
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) throw new Error("Username can only contain letters, numbers, and underscores");

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
