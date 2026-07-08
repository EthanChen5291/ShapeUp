/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import { FREE_GEN_MONTHLY_CAP } from './lib/freeGen';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

function authed(t: ReturnType<typeof convexTest>, clerkId: string) {
  return t.withIdentity({
    subject: clerkId,
    tokenIdentifier: `https://clerk.test|${clerkId}`,
    email: `${clerkId}@example.com`,
    nickname: clerkId,
  });
}

const JAN = Date.UTC(2026, 0, 15); // 2026-01-15, well clear of month boundaries
const FEB = Date.UTC(2026, 1, 15); // 2026-02-15

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('freeGen.consumeGeneration — monthly quota', () => {
  test('grants FREE_GEN_MONTHLY_CAP free generations, then blocks further use this month', async () => {
    vi.setSystemTime(JAN);
    const t = convexTest(schema, modules);
    const user = authed(t, 'user_a');
    const userId = await user.mutation(api.users.getOrCreate, {});
    // Zero the welcome bundle so we exercise the free-generation path.
    await t.run(async (ctx) => ctx.db.patch(userId, { credits: 0 }));

    for (let i = 0; i < FREE_GEN_MONTHLY_CAP; i++) {
      const res = await user.mutation(api.freeGen.consumeGeneration, {
        ipHash: 'ip-a',
        fingerprintHash: `device-a-${i}`,
      });
      expect(res).toEqual({ path: 'free', creditsRemaining: 0 });
    }

    await expect(
      user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip-a', fingerprintHash: 'device-a-extra' }),
    ).rejects.toThrow(/out of free generations/);
  });

  test('unused free generations do not carry into the next month (non-accumulative reset)', async () => {
    vi.setSystemTime(JAN);
    const t = convexTest(schema, modules);
    const user = authed(t, 'user_b');
    const userId = await user.mutation(api.users.getOrCreate, {});
    await t.run(async (ctx) => ctx.db.patch(userId, { credits: 0 }));

    // Use only one of three this month — two go unused.
    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip-b', fingerprintHash: 'device-b-0' });
    let me = await user.query(api.users.getMe, {});
    expect(me?.freeGenRemaining).toBe(FREE_GEN_MONTHLY_CAP - 1);

    // Roll into February: quota resets to the full cap, it does not become
    // "2 leftover + 3 new".
    vi.setSystemTime(FEB);
    me = await user.query(api.users.getMe, {});
    expect(me?.freeGenRemaining).toBe(FREE_GEN_MONTHLY_CAP);

    for (let i = 0; i < FREE_GEN_MONTHLY_CAP; i++) {
      const res = await user.mutation(api.freeGen.consumeGeneration, {
        ipHash: 'ip-b',
        fingerprintHash: `device-b-feb-${i}`,
      });
      expect(res).toEqual({ path: 'free', creditsRemaining: 0 });
    }
    me = await user.query(api.users.getMe, {});
    expect(me?.freeGenRemaining).toBe(0);
  });

  test('a device is capped at the monthly rate across accounts, independent of each account’s own counter', async () => {
    vi.setSystemTime(JAN);
    const t = convexTest(schema, modules);
    const shared = 'shared-device-fingerprint';

    const userA = authed(t, 'user_c');
    const userAId = await userA.mutation(api.users.getOrCreate, {});
    await t.run(async (ctx) => ctx.db.patch(userAId, { credits: 0 }));
    for (let i = 0; i < FREE_GEN_MONTHLY_CAP; i++) {
      await userA.mutation(api.freeGen.consumeGeneration, { ipHash: `ip-c-${i}`, fingerprintHash: shared });
    }

    // A second, fresh account (own counter still at the full cap) sharing the
    // same physical device gets blocked by the device-level Sybil gate.
    const userD = authed(t, 'user_d');
    const userDId = await userD.mutation(api.users.getOrCreate, {});
    await t.run(async (ctx) => ctx.db.patch(userDId, { credits: 0 }));
    await expect(
      userD.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip-d', fingerprintHash: shared }),
    ).rejects.toThrow(/device has already used/);
  });

  test('paid credits are always spent before the monthly free quota', async () => {
    vi.setSystemTime(JAN);
    const t = convexTest(schema, modules);
    const user = authed(t, 'user_e');
    const userId = await user.mutation(api.users.getOrCreate, {});
    await t.run(async (ctx) => ctx.db.patch(userId, { credits: 2 }));

    const res = await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip-e', fingerprintHash: 'device-e' });
    expect(res).toEqual({ path: 'paid', creditsRemaining: 1 });

    const me = await user.query(api.users.getMe, {});
    expect(me?.freeGenRemaining).toBe(FREE_GEN_MONTHLY_CAP);
  });
});
