import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import type { ClerkSession } from '@/lib/serverAuth';
import {
  RateLimitRule,
  enforceRateLimits,
  hashIdentifier,
  rateLimitResponse,
} from '@/lib/rateLimit';

type ConsumeResult = {
  limited: boolean;
  label: string | null;
  retryAfterSeconds: number;
};

export async function enforceDurableRateLimits(
  rules: RateLimitRule[],
  session: NonNullable<ClerkSession>,
  logContext: Record<string, string>,
) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const convexToken = typeof session.getToken === 'function'
    ? await session.getToken({ template: 'convex' }).catch(() => null)
    : null;
  if (!convexUrl || !convexToken) {
    console.warn('[rate-limit] falling back to in-memory limiter: Convex auth unavailable', logContext);
    return enforceRateLimits(rules, logContext);
  }

  try {
    const convex = new ConvexHttpClient(convexUrl);
    convex.setAuth(convexToken);
    const durableRules = rules.map((rule) => {
      if (rule.label.endsWith(':ip')) {
        return {
          scope: 'ip' as const,
          label: rule.label,
          keyHash: hashIdentifier(rule.key),
          limit: rule.limit,
          windowMs: rule.windowMs,
        };
      }
      return {
        scope: 'user' as const,
        label: rule.label,
        limit: rule.limit,
        windowMs: rule.windowMs,
      };
    });
    const result = await convex.mutation(api.rateLimits.consume, { rules: durableRules }) as ConsumeResult;

    if (result.limited && result.label) {
      console.warn('[rate-limit]', {
        limit: result.label,
        retryAfterSeconds: result.retryAfterSeconds,
        durable: 'convex',
        ...logContext,
      });
      return rateLimitResponse(result.label, result.retryAfterSeconds);
    }
    return null;
  } catch (err) {
    console.warn('[rate-limit] falling back to in-memory limiter: Convex check failed', {
      error: err instanceof Error ? err.message : String(err),
      ...logContext,
    });
    return enforceRateLimits(rules, logContext);
  }
}
