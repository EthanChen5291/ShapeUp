import { describe, expect, test } from 'vitest';
import { checkRateLimit, resetRateLimitBucketsForTests } from './rateLimit';

describe('rate limiter', () => {
  test('limits requests inside a window and recovers after reset', () => {
    resetRateLimitBucketsForTests();
    const rule = { key: 'user_123', limit: 2, windowMs: 1000, label: 'test:user' };

    expect(checkRateLimit(rule, 0).limited).toBe(false);
    expect(checkRateLimit(rule, 100).limited).toBe(false);
    expect(checkRateLimit(rule, 200)).toMatchObject({ limited: true, retryAfterSeconds: 1 });
    expect(checkRateLimit(rule, 1100).limited).toBe(false);
  });
});
