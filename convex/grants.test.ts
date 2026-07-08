/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import { WELCOME_BUNDLE_CREDITS, PHONE_BONUS_CREDITS } from './users';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

function identity(t: ReturnType<typeof convexTest>, clerkId: string, email: string) {
  return t.withIdentity({
    subject: clerkId,
    tokenIdentifier: `https://clerk.test|${clerkId}`,
    email,
    nickname: clerkId,
  });
}

describe('welcome bundle', () => {
  test('grants the welcome bundle exactly once for a real email, and is idempotent', async () => {
    const t = convexTest(schema, modules);
    const user = identity(t, 'welcome_a', 'welcome_a@example.com');

    await user.mutation(api.users.getOrCreate, {});
    let me = await user.query(api.users.getMe, {});
    expect(me?.credits).toBe(WELCOME_BUNDLE_CREDITS);
    expect(me?.welcomeGrantedAt).toBeTruthy();

    // A second resolution (app reload) must not re-grant.
    await user.mutation(api.users.getOrCreate, {});
    me = await user.query(api.users.getMe, {});
    expect(me?.credits).toBe(WELCOME_BUNDLE_CREDITS);
  });

  test('withholds the welcome bundle from disposable-email accounts', async () => {
    const t = convexTest(schema, modules);
    const user = identity(t, 'welcome_spam', 'burner@mailinator.com');

    await user.mutation(api.users.getOrCreate, {});
    const me = await user.query(api.users.getMe, {});
    expect(me?.credits).toBe(0);
    expect(me?.welcomeGrantedAt).toBeFalsy();
  });
});

describe('phoneBonus.claimPhoneBonus', () => {
  const SECRET = 'test-phone-secret';
  beforeEach(() => { process.env.PHONE_BONUS_SECRET = SECRET; });
  afterEach(() => { delete process.env.PHONE_BONUS_SECRET; });

  test('rejects callers without the server secret (fails closed)', async () => {
    const t = convexTest(schema, modules);
    const user = identity(t, 'phone_a', 'phone_a@example.com');
    await user.mutation(api.users.getOrCreate, {});

    await expect(
      user.mutation(api.phoneBonus.claimPhoneBonus, { secret: 'wrong', phoneHash: 'h1' }),
    ).rejects.toThrow(/Not authorized/);
  });

  test('grants the bonus once, then is idempotent on repeat', async () => {
    const t = convexTest(schema, modules);
    const user = identity(t, 'phone_b', 'phone_b@example.com');
    const userId = await user.mutation(api.users.getOrCreate, {});
    await t.run(async (ctx) => ctx.db.patch(userId, { credits: 0 }));

    const first = await user.mutation(api.phoneBonus.claimPhoneBonus, { secret: SECRET, phoneHash: 'hash-b' });
    expect(first).toMatchObject({ granted: true, credits: PHONE_BONUS_CREDITS });

    const second = await user.mutation(api.phoneBonus.claimPhoneBonus, { secret: SECRET, phoneHash: 'hash-b' });
    expect(second).toMatchObject({ granted: false, alreadyClaimed: true });

    const me = await user.query(api.users.getMe, {});
    expect(me?.credits).toBe(PHONE_BONUS_CREDITS); // not doubled
  });

  test('blocks the same phone number from claiming on a second account', async () => {
    const t = convexTest(schema, modules);
    const sharedPhone = 'shared-phone-hash';

    const userA = identity(t, 'phone_c', 'phone_c@example.com');
    const aId = await userA.mutation(api.users.getOrCreate, {});
    await t.run(async (ctx) => ctx.db.patch(aId, { credits: 0 }));
    await userA.mutation(api.phoneBonus.claimPhoneBonus, { secret: SECRET, phoneHash: sharedPhone });

    const userB = identity(t, 'phone_d', 'phone_d@example.com');
    await userB.mutation(api.users.getOrCreate, {});
    await expect(
      userB.mutation(api.phoneBonus.claimPhoneBonus, { secret: SECRET, phoneHash: sharedPhone }),
    ).rejects.toThrow(/already claimed/);
  });
});
