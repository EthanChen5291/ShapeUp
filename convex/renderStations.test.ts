/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import { RENDER_STATION_CAPACITY, STALE_AFTER_MS } from './renderStations';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('renderStations', () => {
  test('advertises four customer-level render stations', () => {
    expect(RENDER_STATION_CAPACITY).toBe(4);
  });

  test('claims up to capacity are active; the next is queued behind them', async () => {
    const t = convexTest(schema, modules);

    // Fill every chair. Each claim advances the clock so FIFO order is stable.
    const active = [];
    for (let i = 0; i < RENDER_STATION_CAPACITY; i++) {
      vi.setSystemTime(1000 + i);
      active.push(await t.mutation(api.renderStations.claim, { sessionId: `s${i}` }));
    }
    for (const c of active) {
      expect(c.status).toBe('active');
    }
    // activeCount reflects occupancy at claim time, so the last fill sees a full house.
    expect(active[active.length - 1].activeCount).toBe(RENDER_STATION_CAPACITY);

    // One more than capacity → queued at position 1 (next in line).
    vi.setSystemTime(2000);
    const queued = await t.mutation(api.renderStations.claim, { sessionId: 'extra' });
    expect(queued.status).toBe('queued');
    expect(queued.queuePosition).toBe(1);
    expect(queued.capacity).toBe(RENDER_STATION_CAPACITY);
  });

  test('queue advances when an earlier station is released', async () => {
    const t = convexTest(schema, modules);

    const claims = [];
    for (let i = 0; i < RENDER_STATION_CAPACITY + 1; i++) {
      vi.setSystemTime(1000 + i);
      claims.push(await t.mutation(api.renderStations.claim, {}));
    }
    const last = claims[claims.length - 1];
    expect((await t.query(api.renderStations.status, { jobId: last.jobId })).status).toBe('queued');

    // First chair frees up → the queued render becomes active.
    await t.mutation(api.renderStations.release, { jobId: claims[0].jobId });
    const after = await t.query(api.renderStations.status, { jobId: last.jobId });
    expect(after.status).toBe('active');
    expect(after.activeCount).toBe(RENDER_STATION_CAPACITY);
  });

  test('a stale (un-heartbeated) station stops counting and frees its chair', async () => {
    const t = convexTest(schema, modules);

    vi.setSystemTime(1000);
    const stale = await t.mutation(api.renderStations.claim, {});
    vi.setSystemTime(1001);
    const fresh = await t.mutation(api.renderStations.claim, {});
    // Both live, both active within the four-station capacity.
    expect(fresh.activeCount).toBe(2);

    // Jump past the liveness window without heartbeating `stale`.
    vi.setSystemTime(1000 + STALE_AFTER_MS + 1);
    await t.mutation(api.renderStations.heartbeat, { jobId: fresh.jobId });

    const status = await t.query(api.renderStations.status, { jobId: fresh.jobId });
    expect(status.activeCount).toBe(1); // stale one no longer counts
    // The stale row reports "gone" once it ages out of the live set.
    expect((await t.query(api.renderStations.status, { jobId: stale.jobId })).status).toBe('gone');
  });

  test('heartbeat keeps a station live past the stale window', async () => {
    const t = convexTest(schema, modules);

    vi.setSystemTime(1000);
    const job = await t.mutation(api.renderStations.claim, {});

    // Ping just before each window would expire, several times over.
    for (let beat = 1; beat <= 3; beat++) {
      vi.setSystemTime(1000 + beat * (STALE_AFTER_MS - 1000));
      const res = await t.mutation(api.renderStations.heartbeat, { jobId: job.jobId });
      expect(res.ok).toBe(true);
    }
    expect((await t.query(api.renderStations.status, { jobId: job.jobId })).status).toBe('active');
  });

  test('release and heartbeat are safe on an already-gone station', async () => {
    const t = convexTest(schema, modules);

    const job = await t.mutation(api.renderStations.claim, {});
    await t.mutation(api.renderStations.release, { jobId: job.jobId });

    // Second release is a no-op, not an error.
    await expect(t.mutation(api.renderStations.release, { jobId: job.jobId })).resolves.toBeNull();
    // Heartbeat on a deleted row reports failure rather than resurrecting it.
    expect((await t.mutation(api.renderStations.heartbeat, { jobId: job.jobId })).ok).toBe(false);
    expect((await t.query(api.renderStations.status, { jobId: job.jobId })).status).toBe('gone');
  });
});
