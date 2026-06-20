import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export const REFERRAL_REWARD_TOKENS = 3;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
const CODE_LENGTH = 6;

function randomCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** Generate a referral code that isn't already taken. */
export async function uniqueReferralCode(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const clash = await ctx.db
      .query("users")
      .withIndex("by_referral_code", (q) => q.eq("referralCode", code))
      .unique();
    if (!clash) return code;
  }
  // Extremely unlikely; fall back to a longer code.
  return randomCode() + randomCode();
}

/**
 * Attach a pending referral to a freshly created user, if `code` points to a
 * valid, different referrer and this user has no referral yet. No-op otherwise.
 */
export async function maybeAttachReferral(
  ctx: MutationCtx,
  referredUserId: Id<"users">,
  code: string | undefined,
): Promise<void> {
  if (!code) return;
  const normalized = code.trim().toUpperCase();
  if (!normalized) return;

  const referred = await ctx.db.get(referredUserId);
  if (!referred || referred.referredBy) return; // already attributed

  const referrer = await ctx.db
    .query("users")
    .withIndex("by_referral_code", (q) => q.eq("referralCode", normalized))
    .unique();
  if (!referrer || referrer._id === referredUserId) return; // unknown code or self-referral

  // Guard against a duplicate referral row for this referred user.
  const existing = await ctx.db
    .query("referrals")
    .withIndex("by_referred", (q) => q.eq("referredUserId", referredUserId))
    .first();
  if (existing) return;

  await ctx.db.patch(referredUserId, { referredBy: normalized });
  await ctx.db.insert("referrals", {
    referrerUserId: referrer._id,
    referredUserId,
    referrerCode: normalized,
    status: "pending",
    createdAt: Date.now(),
  });
}

/**
 * Grant the referral reward to both parties once the referred user has made
 * their first project. Idempotent via the pending->rewarded status flip.
 */
export async function grantReferralReward(
  ctx: MutationCtx,
  referredUserId: Id<"users">,
): Promise<void> {
  const referral = await ctx.db
    .query("referrals")
    .withIndex("by_referred", (q) => q.eq("referredUserId", referredUserId))
    .first();
  if (!referral || referral.status !== "pending") return;

  const referrer = await ctx.db.get(referral.referrerUserId);
  const referred = await ctx.db.get(referral.referredUserId);
  if (!referrer || !referred) return;

  await ctx.db.patch(referral._id, { status: "rewarded", rewardedAt: Date.now() });
  await ctx.db.patch(referrer._id, { credits: referrer.credits + REFERRAL_REWARD_TOKENS });
  await ctx.db.patch(referred._id, { credits: referred.credits + REFERRAL_REWARD_TOKENS });
}
