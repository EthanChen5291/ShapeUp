import { mutation } from "./_generated/server";
import { v } from "convex/values";

const MAX_RULES_PER_CALL = 4;
const MAX_WINDOW_MS = 24 * 60 * 60_000;

function assertReasonableRule(label: string, limit: number, windowMs: number) {
  if (!/^[a-z0-9:-]{1,64}$/.test(label)) throw new Error("Invalid rate limit label");
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new Error("Invalid rate limit");
  if (!Number.isInteger(windowMs) || windowMs < 1_000 || windowMs > MAX_WINDOW_MS) throw new Error("Invalid rate limit window");
}

export const consume = mutation({
  args: {
    rules: v.array(v.union(
      v.object({
        scope: v.literal("user"),
        label: v.string(),
        limit: v.number(),
        windowMs: v.number(),
      }),
      v.object({
        scope: v.literal("ip"),
        label: v.string(),
        keyHash: v.string(),
        limit: v.number(),
        windowMs: v.number(),
      }),
    )),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    if (args.rules.length > MAX_RULES_PER_CALL) throw new Error("Too many rate limit rules");

    const now = Date.now();
    for (const rule of args.rules) {
      assertReasonableRule(rule.label, rule.limit, rule.windowMs);
      const subject = rule.scope === "user" ? identity.tokenIdentifier : rule.keyHash;
      if (rule.scope === "ip" && !/^[a-f0-9]{12,64}$/.test(subject)) throw new Error("Invalid rate limit key");
      const key = `${rule.label}:${subject}`;

      const existing = await ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();

      if (!existing || now - existing.windowStart >= rule.windowMs) {
        if (existing) {
          await ctx.db.patch(existing._id, { windowStart: now, count: 1 });
        } else {
          await ctx.db.insert("rateLimits", { key, windowStart: now, count: 1 });
        }
        continue;
      }

      if (existing.count >= rule.limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((rule.windowMs - (now - existing.windowStart)) / 1000));
        return {
          limited: true,
          label: rule.label,
          retryAfterSeconds,
        };
      }

      await ctx.db.patch(existing._id, { count: existing.count + 1 });
    }

    return {
      limited: false,
      label: null,
      retryAfterSeconds: 0,
    };
  },
});
