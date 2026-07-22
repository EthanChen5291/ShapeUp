/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import {
  BARBER_BATCH_IP_CAP,
  BARBER_BATCH_ITEM_COUNT,
  BARBER_BATCH_STALE_MS,
} from "./lib/barberBatch";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function authed(t: ReturnType<typeof convexTest>, clerkId: string, email = `${clerkId}@example.com`) {
  return t.withIdentity({
    subject: clerkId,
    tokenIdentifier: `https://clerk.test|${clerkId}`,
    email,
    nickname: clerkId,
  });
}

async function account(
  t: ReturnType<typeof convexTest>,
  clerkId: string,
  email = `${clerkId}@example.com`,
) {
  const client = authed(t, clerkId, email);
  await client.mutation(api.users.getOrCreate, {});
  return client;
}

const JAN = Date.UTC(2026, 0, 15);
const FEB = Date.UTC(2026, 1, 15);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("barberBatch.consumeBatch", () => {
  test("allows one batch per user per calendar month", async () => {
    vi.setSystemTime(JAN);
    const t = convexTest(schema, modules);
    const user = await account(t, "monthly-user");

    await expect(
      user.mutation(api.barberBatch.consumeBatch, {
        ipHash: "monthly-ip-1",
        fingerprintHash: "monthly-device-1",
      }),
    ).resolves.toEqual({ path: "free", batchesRemaining: 0 });
    await expect(
      user.mutation(api.barberBatch.consumeBatch, {
        ipHash: "monthly-ip-2",
        fingerprintHash: "monthly-device-2",
      }),
    ).rejects.toThrow(/already used.*this month/i);
  });

  test("resets the entitlement at calendar-month rollover", async () => {
    vi.setSystemTime(JAN);
    const t = convexTest(schema, modules);
    const user = await account(t, "rollover-user");
    await user.mutation(api.barberBatch.consumeBatch, {
      ipHash: "rollover-ip",
      fingerprintHash: "rollover-device",
    });

    vi.setSystemTime(FEB);
    await expect(
      user.mutation(api.barberBatch.consumeBatch, {
        ipHash: "rollover-ip",
        fingerprintHash: "rollover-device",
      }),
    ).resolves.toEqual({ path: "free", batchesRemaining: 0 });
  });

  test("caps a fingerprint at the same monthly rate across accounts", async () => {
    vi.setSystemTime(JAN);
    const t = convexTest(schema, modules);
    const first = await account(t, "fingerprint-first");
    await first.mutation(api.barberBatch.consumeBatch, {
      ipHash: "fingerprint-ip-1",
      fingerprintHash: "shared-fingerprint",
    });

    const second = await account(t, "fingerprint-second");
    await expect(
      second.mutation(api.barberBatch.consumeBatch, {
        ipHash: "fingerprint-ip-2",
        fingerprintHash: "shared-fingerprint",
      }),
    ).rejects.toThrow(/device has already used/i);
  });

  test("uses the shared-network allowance only as a daily backstop", async () => {
    vi.setSystemTime(JAN);
    const t = convexTest(schema, modules);

    for (let i = 0; i < BARBER_BATCH_IP_CAP; i++) {
      const user = await account(t, `network-user-${i}`);
      await user.mutation(api.barberBatch.consumeBatch, {
        ipHash: "shared-network",
        fingerprintHash: `network-device-${i}`,
      });
    }

    const blocked = await account(t, "network-blocked");
    await expect(
      blocked.mutation(api.barberBatch.consumeBatch, {
        ipHash: "shared-network",
        fingerprintHash: "network-device-blocked",
      }),
    ).rejects.toThrow(/too many.*network/i);
  });

  test("serializes concurrent attempts so the monthly grant cannot be double-spent", async () => {
    vi.setSystemTime(JAN);
    const t = convexTest(schema, modules);
    const user = await account(t, "concurrent-user");

    const outcomes = await Promise.allSettled([
      user.mutation(api.barberBatch.consumeBatch, {
        ipHash: "concurrent-ip-1",
        fingerprintHash: "concurrent-device-1",
      }),
      user.mutation(api.barberBatch.consumeBatch, {
        ipHash: "concurrent-ip-2",
        fingerprintHash: "concurrent-device-2",
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const userGrantCount = await t.run(async (ctx) => {
      const grants = await ctx.db
        .query("freeGenGrants")
        .withIndex("by_signal", (q) => q.eq("signalType", "barberBatchUser"))
        .take(2);
      return grants.length;
    });
    expect(userGrantCount).toBe(1);
  });

  test("reuses the permanent-email gate", async () => {
    vi.setSystemTime(JAN);
    const t = convexTest(schema, modules);
    const user = await account(t, "temporary-email", "temporary-email@mailinator.com");

    await expect(
      user.mutation(api.barberBatch.consumeBatch, {
        ipHash: "temporary-ip",
        fingerprintHash: "temporary-device",
      }),
    ).rejects.toThrow(/permanent email/i);
  });
});

describe("barber batch lifecycle", () => {
  test("resolves stored media and projects non-terminal items older than five minutes as failed", async () => {
    vi.setSystemTime(JAN);
    const t = convexTest(schema, modules);
    const barber = await account(t, "batch-barber");
    await barber.mutation(api.barberPages.upsert, {
      slug: "batch-barber",
      displayName: "Batch Barber",
      links: [],
      styles: [],
      published: true,
    });
    const client = await account(t, "batch-client");
    const selfieStorageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["selfie"], { type: "image/jpeg" })),
    );
    const batchId = await client.mutation(api.barberBatch.create, {
      slug: "batch-barber",
      selfieStorageId,
    });
    const analysis = await client.mutation(api.barberBatch.setAnalysis, {
      batchId,
      result: {
        ok: true,
        hairProfile: {
          curlClass: "3B",
          lengthInches: { top: 4, sides: 2, back: 2 },
          density: "high",
          hairline: { state: "mature", notes: "slight temple recession" },
          growthPatterns: ["crown whorl"],
          faceShape: "oval",
          barberNotes: "Keep weight at the temples.",
        },
        items: Array.from({ length: BARBER_BATCH_ITEM_COUNT }, (_, idx) => ({
          idx,
          title: `Style ${idx}`,
          prompt: `Create style ${idx}`,
          why: `Reason ${idx}`,
        })),
      },
    });
    expect(analysis.status).toBe("generating");
    expect(analysis.items).toHaveLength(BARBER_BATCH_ITEM_COUNT);

    const imageStorageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["edited"], { type: "image/jpeg" })),
    );
    await client.mutation(api.barberBatch.patchItem, {
      itemId: analysis.items[0].itemId,
      status: "done",
      imageStorageId,
      splatS3Key: "facelifts/job-0/output.splat",
      videoS3Key: "facelifts/job-0/turntable.mp4",
    });

    let latest = await client.query(api.barberBatch.latestForPage, { slug: "batch-barber" });
    expect(latest?.items[0]).toMatchObject({
      status: "done",
      splatS3Key: "facelifts/job-0/output.splat",
      videoS3Key: "facelifts/job-0/turntable.mp4",
    });
    expect(latest?.items[0].imageUrl).toEqual(expect.any(String));
    expect(latest?.selfieUrl).toEqual(expect.any(String));

    vi.setSystemTime(JAN + BARBER_BATCH_STALE_MS + 1);
    latest = await client.query(api.barberBatch.latestForPage, { slug: "batch-barber" });
    expect(latest?.items[0]).toMatchObject({ status: "done", stale: false });
    expect(latest?.items[1]).toMatchObject({ status: "failed", stale: true });

    const retryItem = await client.query(api.barberBatch.getItemForRetry, {
      itemId: analysis.items[1].itemId,
    });
    expect(retryItem).toMatchObject({
      batchId,
      idx: 1,
      status: "failed",
      stale: true,
      prompt: "Create style 1",
    });
    expect(retryItem.selfieUrl).toEqual(expect.any(String));

    await expect(
      barber.query(api.barberBatch.getItemForRetry, { itemId: analysis.items[1].itemId }),
    ).rejects.toThrow(/batch not found/i);

    await client.mutation(api.barberBatch.patchItem, {
      itemId: analysis.items[1].itemId,
      status: "editing",
      prompt: "Create style 1. Final touches: soften the temple edge.",
    });
    latest = await client.query(api.barberBatch.latestForPage, { slug: "batch-barber" });
    expect(latest?.items[1]).toMatchObject({
      status: "editing",
      stale: false,
      prompt: "Create style 1. Final touches: soften the temple edge.",
    });
  });
});
