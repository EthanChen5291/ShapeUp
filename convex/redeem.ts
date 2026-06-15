import { internalMutation, mutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { enforceMutationRateLimit } from "./lib/rateLimit";

const REDEEM_LIMIT = 10;
const REDEEM_WINDOW_MS = 60 * 60 * 1000;

/**
 * Redeem a custom token code for the signed-in user. Validates that the code is
 * active, unexpired, under its use cap, and not already redeemed by this user.
 */
export const redeem = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("You need to be signed in to redeem a code.");

    await enforceMutationRateLimit(
      ctx,
      `redeem:${identity.tokenIdentifier}`,
      REDEEM_LIMIT,
      REDEEM_WINDOW_MS,
    );

    const normalized = args.code.trim().toUpperCase();
    if (!normalized) throw new ConvexError("Enter a code to redeem.");

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError("Couldn't find your account. Please reload and try again.");

    const codeDoc = await ctx.db
      .query("redeemCodes")
      .withIndex("by_code", (q) => q.eq("code", normalized))
      .unique();
    if (!codeDoc || !codeDoc.active) throw new ConvexError("That code isn't valid.");
    if (codeDoc.expiresAt && codeDoc.expiresAt < Date.now()) throw new ConvexError("That code has expired.");
    if (codeDoc.maxUses !== undefined && codeDoc.usedCount >= codeDoc.maxUses) {
      throw new ConvexError("That code has been fully redeemed.");
    }

    const already = await ctx.db
      .query("redeemRedemptions")
      .withIndex("by_user_and_code", (q) => q.eq("userId", user._id).eq("code", normalized))
      .unique();
    if (already) throw new ConvexError("You've already redeemed this code.");

    await ctx.db.insert("redeemRedemptions", {
      userId: user._id,
      code: normalized,
      tokens: codeDoc.tokens,
      redeemedAt: Date.now(),
    });
    await ctx.db.patch(codeDoc._id, { usedCount: codeDoc.usedCount + 1 });
    await ctx.db.patch(user._id, { credits: user.credits + codeDoc.tokens });

    return { tokens: codeDoc.tokens, credits: user.credits + codeDoc.tokens };
  },
});

/** Mint or update a redeemable code. Call from the Convex dashboard/CLI. */
export const createRedeemCode = internalMutation({
  args: {
    code: v.string(),
    tokens: v.number(),
    maxUses: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const normalized = args.code.trim().toUpperCase();
    if (!normalized) throw new Error("Code is required");
    if (!Number.isFinite(args.tokens) || args.tokens <= 0) throw new Error("tokens must be > 0");

    const existing = await ctx.db
      .query("redeemCodes")
      .withIndex("by_code", (q) => q.eq("code", normalized))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        tokens: args.tokens,
        maxUses: args.maxUses,
        expiresAt: args.expiresAt,
        active: args.active ?? existing.active,
      });
      return existing._id;
    }
    return ctx.db.insert("redeemCodes", {
      code: normalized,
      tokens: args.tokens,
      maxUses: args.maxUses,
      usedCount: 0,
      expiresAt: args.expiresAt,
      active: args.active ?? true,
    });
  },
});
