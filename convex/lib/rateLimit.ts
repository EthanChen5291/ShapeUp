import type { MutationCtx } from "../_generated/server";

export async function enforceMutationRateLimit(
  ctx: MutationCtx,
  key: string,
  limit: number,
  windowMs: number,
) {
  const now = Date.now();
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();

  if (!existing || now - existing.windowStart >= windowMs) {
    if (existing) {
      await ctx.db.patch(existing._id, { windowStart: now, count: 1 });
    } else {
      await ctx.db.insert("rateLimits", { key, windowStart: now, count: 1 });
    }
    return;
  }

  if (existing.count >= limit) {
    const retryAfterMs = Math.max(0, windowMs - (now - existing.windowStart));
    throw new Error(`Too many changes. Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`);
  }

  await ctx.db.patch(existing._id, { count: existing.count + 1 });
}
