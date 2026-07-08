// Shared constants/helpers for the free-generation monthly quota, used by both
// convex/freeGen.ts (spending) and convex/users.ts (display). Free accounts get
// FREE_GEN_MONTHLY_CAP generations per calendar month; unused ones do NOT roll
// over — the count simply resets when the month key changes.

export const FREE_GEN_MONTHLY_CAP = 3;

/** UTC "YYYY-MM" bucket for the given time (defaults to now). */
export function currentMonthKey(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 7);
}

/**
 * How many free generations remain for this user in the current month.
 * `freeGenUsedInMonth` only reflects usage if `freeGenMonthKey` matches the
 * current bucket — a stale bucket (from a prior month) means nothing has been
 * used yet this month, regardless of the stored count.
 */
export function freeGenRemainingForUser(
  user: { freeGenMonthKey?: string; freeGenUsedInMonth?: number },
  now: number = Date.now(),
): number {
  const usedThisMonth = user.freeGenMonthKey === currentMonthKey(now) ? (user.freeGenUsedInMonth ?? 0) : 0;
  return Math.max(0, FREE_GEN_MONTHLY_CAP - usedThisMonth);
}
