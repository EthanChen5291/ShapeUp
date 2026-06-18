import { mutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { isDisposableEmailDomain } from "./lib/disposableEmail";

// Loose per-IP cap on free generations — shared offices, dorms, and CGNAT mean
// many legit users can share one IP, so this is a backstop, not the main gate.
const FREE_GEN_IP_CAP = 3;
const FREE_GEN_IP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Consume one generation's entitlement, transactionally.
 *
 * Order of precedence:
 *   1. Paid credits — always spent first when available.
 *   2. One-time free generation — only at zero credits, and only if the request
 *      clears the anti-Sybil gates (per-account flag, verified non-disposable
 *      email, device fingerprint, per-IP cap).
 *
 * The whole handler runs as a single serializable Convex transaction, so
 * concurrent requests from the same account can't double-spend either path
 * (the classic "fire 10 requests before the flag flips" attack).
 *
 * `ipHash` / `fingerprintHash` are pre-hashed by the calling route (we never
 * store raw IPs or fingerprints). `fingerprintHash` is optional: when the
 * client can't produce one, the account flag + IP cap + email gate still apply.
 */
export const consumeGeneration = mutation({
  args: {
    ipHash: v.string(),
    fingerprintHash: v.optional(v.string()),
  },
  handler: async (ctx, { ipHash, fingerprintHash }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError("Couldn't find your account. Please reload and try again.");

    // 1. Paid credits take precedence over the free generation.
    if (user.credits > 0) {
      await ctx.db.patch(user._id, { credits: user.credits - 1 });
      return { path: "paid" as const, creditsRemaining: user.credits - 1 };
    }

    // 2. Free-generation path. One per account, ever.
    if (user.freeGenUsedAt) {
      throw new ConvexError("You're out of credits. Add more to keep creating.");
    }

    // Require a verified, non-disposable email so throwaway inboxes can't farm.
    // `emailVerified` is only blocked when explicitly false — the claim may be
    // absent on older JWT templates (see auth.config.ts), and we'd rather not
    // hard-block legit users until that claim is guaranteed present.
    if (identity.emailVerified === false) {
      throw new ConvexError("Please verify your email to use your free generation.");
    }
    const email = (user.email ?? identity.email ?? "").toLowerCase();
    if (!email || isDisposableEmailDomain(email)) {
      throw new ConvexError("A permanent email address is required for the free generation.");
    }

    // Device-fingerprint Sybil check: one free generation per physical device,
    // regardless of how many accounts it creates.
    if (fingerprintHash) {
      const prior = await ctx.db
        .query("freeGenGrants")
        .withIndex("by_signal", (q) =>
          q.eq("signalType", "fingerprint").eq("signalHash", fingerprintHash),
        )
        .first();
      if (prior) {
        throw new ConvexError("This device has already used its free generation.");
      }
    }

    // Per-IP backstop: cap recent free grants from the same network.
    const since = Date.now() - FREE_GEN_IP_WINDOW_MS;
    const recentIpGrants = await ctx.db
      .query("freeGenGrants")
      .withIndex("by_signal", (q) => q.eq("signalType", "ip").eq("signalHash", ipHash))
      .order("desc")
      .take(FREE_GEN_IP_CAP + 1);
    if (recentIpGrants.filter((g) => g.grantedAt >= since).length >= FREE_GEN_IP_CAP) {
      throw new ConvexError("Too many free generations from this network. Add credits to continue.");
    }

    // Commit the entitlement: mark the account and record the signals. All in
    // this one transaction, so it's atomic with the checks above.
    const now = Date.now();
    await ctx.db.patch(user._id, { freeGenUsedAt: now });
    await ctx.db.insert("freeGenGrants", {
      signalType: "ip",
      signalHash: ipHash,
      userId: user._id,
      grantedAt: now,
    });
    if (fingerprintHash) {
      await ctx.db.insert("freeGenGrants", {
        signalType: "fingerprint",
        signalHash: fingerprintHash,
        userId: user._id,
        grantedAt: now,
      });
    }

    return { path: "free" as const, creditsRemaining: 0 };
  },
});
