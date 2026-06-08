import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

type Bucket = {
  windowStart: number;
  count: number;
};

export type RateLimitRule = {
  key: string;
  limit: number;
  windowMs: number;
  label: string;
};

const buckets = new Map<string, Bucket>();

export const RATE_LIMITS = {
  editUser: { limit: 20, windowMs: 60_000, label: 'edit:user' },
  editIp: { limit: 60, windowMs: 60_000, label: 'edit:ip' },
  summaryUser: { limit: 10, windowMs: 60_000, label: 'summary:user' },
  summaryIp: { limit: 30, windowMs: 60_000, label: 'summary:ip' },
  saveScanUser: { limit: 10, windowMs: 60 * 60_000, label: 'save-scan:user' },
  saveScanIp: { limit: 30, windowMs: 60 * 60_000, label: 'save-scan:ip' },
  faceliftUser: { limit: 5, windowMs: 10 * 60_000, label: 'facelift:user' },
  faceliftIp: { limit: 20, windowMs: 10 * 60_000, label: 'facelift:ip' },
} as const;

export function getClientIp(req: NextRequest | Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || req.headers.get('x-real-ip') || 'unknown';
}

export function hashIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

export function checkRateLimit(rule: RateLimitRule, now = Date.now()) {
  const bucketKey = `${rule.label}:${rule.key}`;
  const current = buckets.get(bucketKey);
  if (!current || now - current.windowStart >= rule.windowMs) {
    buckets.set(bucketKey, { windowStart: now, count: 1 });
    return { limited: false, remaining: rule.limit - 1, retryAfterSeconds: 0 };
  }

  if (current.count >= rule.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((rule.windowMs - (now - current.windowStart)) / 1000));
    return { limited: true, remaining: 0, retryAfterSeconds };
  }

  current.count += 1;
  return { limited: false, remaining: rule.limit - current.count, retryAfterSeconds: 0 };
}

export function rateLimitResponse(label: string, retryAfterSeconds: number) {
  return NextResponse.json(
    { error: 'Rate limit exceeded', code: 'rate_limited', limit: label, retryAfterSeconds },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
}

export function enforceRateLimits(rules: RateLimitRule[], logContext: Record<string, string>) {
  for (const rule of rules) {
    const result = checkRateLimit(rule);
    if (result.limited) {
      console.warn('[rate-limit]', {
        limit: rule.label,
        retryAfterSeconds: result.retryAfterSeconds,
        ...logContext,
      });
      return rateLimitResponse(rule.label, result.retryAfterSeconds);
    }
  }
  return null;
}

export function resetRateLimitBucketsForTests() {
  buckets.clear();
}
