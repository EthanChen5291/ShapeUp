/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

describe('contact.submitMessage', () => {
  test('stores a valid message', async () => {
    const t = convexTest(schema, modules);
    const res = await t.mutation(api.contact.submitMessage, {
      name: 'Alex Rivera',
      email: 'Alex@Example.com',
      topic: 'support',
      message: 'My scan looks a little off — can you take a look?',
      hp: '',
    });
    expect(res.ok).toBe(true);

    const rows = await t.run(async (ctx) => ctx.db.query('contactMessages').collect());
    expect(rows).toHaveLength(1);
    // Email is normalized to lowercase, name trimmed, topic preserved.
    expect(rows[0]).toMatchObject({
      name: 'Alex Rivera',
      email: 'alex@example.com',
      topic: 'support',
    });
  });

  test('honeypot submissions are silently dropped (not stored)', async () => {
    const t = convexTest(schema, modules);
    const res = await t.mutation(api.contact.submitMessage, {
      name: 'Spam Bot',
      email: 'bot@spam.com',
      topic: 'support',
      message: 'buy cheap things now buy cheap things',
      hp: 'i-am-a-bot',
    });
    expect(res.ok).toBe(true);

    const rows = await t.run(async (ctx) => ctx.db.query('contactMessages').collect());
    expect(rows).toHaveLength(0);
  });

  test('rejects an invalid email', async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.contact.submitMessage, {
        name: 'Alex',
        email: 'not-an-email',
        topic: 'support',
        message: 'This is a valid length message.',
        hp: '',
      }),
    ).rejects.toThrow(/valid email/i);
  });

  test('rejects a too-short message', async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.contact.submitMessage, {
        name: 'Alex',
        email: 'alex@example.com',
        topic: 'support',
        message: 'hi',
        hp: '',
      }),
    ).rejects.toThrow(/more detail/i);
  });

  test('rejects a blank name', async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.contact.submitMessage, {
        name: '   ',
        email: 'alex@example.com',
        topic: 'support',
        message: 'A perfectly reasonable message here.',
        hp: '',
      }),
    ).rejects.toThrow(/name/i);
  });

  test('coerces an unknown topic to "other"', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.contact.submitMessage, {
      name: 'Alex',
      email: 'alex@example.com',
      topic: 'totally-made-up',
      message: 'A perfectly reasonable message here.',
      hp: '',
    });
    const rows = await t.run(async (ctx) => ctx.db.query('contactMessages').collect());
    expect(rows[0].topic).toBe('other');
  });
});
