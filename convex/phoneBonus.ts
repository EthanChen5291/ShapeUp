import { mutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { PHONE_BONUS_CREDITS } from "./users";

/**
 * Grant the one-time phone-verification bonus (+PHONE_BONUS_CREDITS credits).
 *
 * Trust model — this is a public mutation, but it must NOT be callable directly
 * by a browser client (that would let anyone self-grant credits). Two gates:
 *
 *   1. `secret` must match PHONE_BONUS_SECRET (a Convex env var). Only our
 *      server-side /api/phone-bonus/claim route knows it; the route is the sole
 *      caller, and it independently verifies against Clerk's backend that the
 *      account actually owns a *verified* phone before calling here. Fail closed
 *      if the env var is unset.
 *   2. `phoneHash` is a pre-hashed E.164 number (we never store raw numbers).
 *      One bonus per physical number, tracked in freeGenGrants, so re-verifying
 *      the same phone on a fresh account can't farm the bonus.
 *
 * `phoneBonusGrantedAt` makes the per-account grant idempotent, so a double
 * submit (or a retry) never double-credits.
 */
export const claimPhoneBonus = mutation({
  args: {
    secret: v.string(),
    phoneHash: v.string(),
  },
  handler: async (ctx, { secret, phoneHash }) => {
    const expected = process.env.PHONE_BONUS_SECRET;
    // Fail closed: no configured secret ⇒ nobody can claim (prevents an
    // accidentally-open grant if the env var is missing in a deployment).
    if (!expected || secret !== expected) {
      throw new ConvexError({ code: "forbidden", message: "Not authorized to claim the phone bonus." });
    }

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError({ code: "account_missing", message: "Couldn't find your account. Please reload and try again." });

    // Already claimed on this account — idempotent no-op.
    if (user.phoneBonusGrantedAt) {
      return { granted: false as const, alreadyClaimed: true as const, credits: user.credits };
    }

    // One bonus per physical phone number, across all accounts.
    const priorPhoneGrant = await ctx.db
      .query("freeGenGrants")
      .withIndex("by_signal", (q) => q.eq("signalType", "phone").eq("signalHash", phoneHash))
      .first();
    if (priorPhoneGrant) {
      throw new ConvexError({ code: "phone_used", message: "This phone number has already claimed the bonus." });
    }

    const now = Date.now();
    const credits = user.credits + PHONE_BONUS_CREDITS;
    await ctx.db.patch(user._id, { credits, phoneBonusGrantedAt: now });
    await ctx.db.insert("freeGenGrants", {
      signalType: "phone",
      signalHash: phoneHash,
      userId: user._id,
      grantedAt: now,
    });

    return { granted: true as const, alreadyClaimed: false as const, credits, awarded: PHONE_BONUS_CREDITS };
  },
});
