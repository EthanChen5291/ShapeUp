import { mutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { isDisposableEmailDomain } from "./lib/disposableEmail";
import { FREE_GEN_MONTHLY_CAP, currentMonthKey, freeGenRemainingForUser } from "./lib/freeGen";

// Loose per-IP cap on free generations — shared offices, dorms, and CGNAT mean
// many legit users can share one IP, so this is a backstop, not the main gate.
const FREE_GEN_IP_CAP = 5;
const FREE_GEN_IP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Consume one generation's entitlement, transactionally.
 *
 * Order of precedence:
 *   1. Paid credits — always spent first when available.
 *   2. Monthly free generations (FREE_GEN_MONTHLY_CAP/month, reset — not
 *      accumulated — each calendar month) — only at zero credits, and only if
 *      the request clears the anti-Sybil gates (per-account monthly counter,
 *      verified non-disposable email, device fingerprint capped at the same
 *      monthly rate, per-IP cap).
 *
 * The whole handler runs as a single serializable Convex transaction, so
 * concurrent requests from the same account can't double-spend either path
 * (the classic "fire 10 requests before the flag flips" attack).
 *
 * `ipHash` / `fingerprintHash` are pre-hashed by the calling route (we never
 * store raw IPs or fingerprints). `fingerprintHash` is optional: when the
 * client can't produce one, the account counter + IP cap + email gate still apply.
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
    if (!user) throw new ConvexError({ code: "account_missing", message: "Couldn't find your account. Please reload and try again." });

    // 1. Paid credits take precedence over the free generation.
    if (user.credits > 0) {
      await ctx.db.patch(user._id, { credits: user.credits - 1 });
      return { path: "paid" as const, creditsRemaining: user.credits - 1 };
    }

    // 2. Free-generation path: FREE_GEN_MONTHLY_CAP per account per calendar
    // month. Unused ones don't roll over — freeGenRemainingForUser treats a
    // stale month bucket as zero used.
    const monthKey = currentMonthKey();
    const remaining = freeGenRemainingForUser(user);
    if (remaining <= 0) {
      throw new ConvexError({ code: "out_of_credits", message: "You're out of free generations for this month. Add credits to keep creating." });
    }

    // Require a verified, non-disposable email so throwaway inboxes can't farm.
    // We only block when the claim is *explicitly* unverified — if the JWT
    // template doesn't emit `email_verified` at all (claim absent → undefined),
    // we fail open rather than hard-block legit users. The claim can arrive as a
    // real boolean or a "false" string depending on how Clerk renders the
    // shortcode, so accept both. See convex/auth.config.ts + the Clerk JWT
    // template ({{user.email_verified}}).
    const emailVerified = identity.emailVerified as boolean | string | undefined;
    if (emailVerified === false || emailVerified === "false") {
      throw new ConvexError({ code: "email_unverified", message: "Please verify your email to use your free generation." });
    }
    // Use `||` (not `??`) so a stored empty-string email still falls back to the
    // JWT claim — `??` only short-circuits on null/undefined, so a `user.email`
    // of "" would otherwise block a legitimate free generation.
    const email = (user.email || identity.email || "").toLowerCase().trim();
    if (!email || isDisposableEmailDomain(email)) {
      throw new ConvexError({ code: "email_required", message: "A permanent email address is required for the free generation." });
    }

    // Device-fingerprint Sybil check: a physical device is capped at the same
    // monthly rate as an account, so spinning up N accounts on one device can't
    // exceed what one honest account would get in a month.
    const [monthYearStr, monthNumStr] = monthKey.split("-");
    const monthStartMs = Date.UTC(Number(monthYearStr), Number(monthNumStr) - 1, 1);
    if (fingerprintHash) {
      const recentFingerprintGrants = await ctx.db
        .query("freeGenGrants")
        .withIndex("by_signal", (q) =>
          q.eq("signalType", "fingerprint").eq("signalHash", fingerprintHash),
        )
        .order("desc")
        .take(FREE_GEN_MONTHLY_CAP + 1);
      if (recentFingerprintGrants.filter((g) => g.grantedAt >= monthStartMs).length >= FREE_GEN_MONTHLY_CAP) {
        throw new ConvexError({ code: "free_gen_used", message: "This device has already used its free generations for this month." });
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
      throw new ConvexError({ code: "network_limited", message: "Too many free generations from this network. Add credits to continue." });
    }

    // Commit the entitlement: bump this month's counter and record the
    // signals. All in this one transaction, so it's atomic with the checks
    // above. usedThisMonth is 0 whenever the stored bucket is stale (a new
    // month), which is exactly the "doesn't accumulate" reset behavior.
    const usedThisMonth = user.freeGenMonthKey === monthKey ? (user.freeGenUsedInMonth ?? 0) : 0;
    const now = Date.now();
    await ctx.db.patch(user._id, { freeGenMonthKey: monthKey, freeGenUsedInMonth: usedThisMonth + 1 });
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
