// ============================================================
// renderStations — live occupancy of the GPU render "chairs".
//
// The 3D facelift step runs on the primary GPU worker with a hard cap of
// `max_containers` GPUs (server/modal_facelift.py). When every GPU is
// busy, the worker silently QUEUES the next request inside the synchronous
// /process_image call — the caller just waits, with no signal that it's
// in line. To surface that wait in the UI we track occupancy ourselves:
// each client inserts one row when it starts a render, heartbeats while
// it runs, and deletes the row when done. Counting the live rows (and a
// client's FIFO rank among them) tells us whether that client holds a
// chair or is waiting, and at what position.
//
// This is an APPROXIMATION of the worker's internal queue, not a readout
// of it — it exposes no per-request queue position. It's honest at the
// scale that matters (a handful of simultaneous demo users) and degrades
// safely: a crashed/abandoned client stops heartbeating and its row ages
// out of the live set within STALE_AFTER_MS, so it can never wedge the
// queue shut.
// ============================================================

import { v } from "convex/values";
import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

// Must match `max_containers` in server/modal_facelift.py. If you raise the
// GPU cap there, raise this too (or the UI will queue users who actually
// have a free chair waiting).
export const RENDER_STATION_CAPACITY = 2;

// How fresh a heartbeat must be to count as live. The client pings every
// ~3s (see EditPanel), so 12s tolerates a few dropped beats / a slow tab
// before we assume the render died and stop counting it.
export const STALE_AFTER_MS = 12_000;

// Cap on rows scanned per call. Live occupancy is tiny (capacity + a short
// queue), so this is only a guard against an unbounded scan if reaping ever
// falls behind.
const SCAN_LIMIT = 64;

type StationStatus = {
  // "active" = this render holds one of the GPU chairs (running or about to).
  // "queued" = all chairs busy; waiting in line behind earlier renders.
  // "gone"   = the row no longer exists (reaped or already released); the
  //            caller should treat its render as proceeding, never blocked.
  status: "active" | "queued" | "gone";
  // 1-based place in line when queued (1 = next to get a chair); 0 otherwise.
  queuePosition: number;
  // Live renders currently holding a chair (≤ capacity).
  activeCount: number;
  capacity: number;
};

// Live rows (fresh heartbeat) in FIFO order — oldest render first. Bounded by
// SCAN_LIMIT; the working set is always small.
async function liveStationsFifo(
  ctx: QueryCtx | MutationCtx,
  now: number,
): Promise<Doc<"renderStations">[]> {
  const cutoff = now - STALE_AFTER_MS;
  const live = await ctx.db
    .query("renderStations")
    .withIndex("by_heartbeat", (q) => q.gt("heartbeatAt", cutoff))
    .take(SCAN_LIMIT);
  // The heartbeat index orders by heartbeatAt; re-sort by arrival so position
  // in line reflects who started waiting first, not who pinged most recently.
  return live.sort((a, b) => a._creationTime - b._creationTime);
}

function statusFor(
  live: Doc<"renderStations">[],
  jobId: Id<"renderStations">,
): StationStatus {
  const idx = live.findIndex((row) => row._id === jobId);
  const activeCount = Math.min(live.length, RENDER_STATION_CAPACITY);
  if (idx === -1) {
    return { status: "gone", queuePosition: 0, activeCount, capacity: RENDER_STATION_CAPACITY };
  }
  if (idx < RENDER_STATION_CAPACITY) {
    return { status: "active", queuePosition: 0, activeCount, capacity: RENDER_STATION_CAPACITY };
  }
  return {
    status: "queued",
    queuePosition: idx - RENDER_STATION_CAPACITY + 1,
    activeCount,
    capacity: RENDER_STATION_CAPACITY,
  };
}

// Delete rows whose heartbeat has aged out. Opportunistic — runs on claim so
// the table self-cleans without a cron. Bounded per call.
async function reapStale(ctx: MutationCtx, now: number): Promise<void> {
  const cutoff = now - STALE_AFTER_MS;
  const stale = await ctx.db
    .query("renderStations")
    .withIndex("by_heartbeat", (q) => q.lte("heartbeatAt", cutoff))
    .take(SCAN_LIMIT);
  for (const row of stale) {
    await ctx.db.delete("renderStations", row._id);
  }
}

// Take a chair (or a place in line). Returns the row id the client holds onto
// for heartbeating/releasing, plus the status at the moment of claiming.
export const claim = mutation({
  args: { sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    await reapStale(ctx, now);
    const jobId = await ctx.db.insert("renderStations", {
      sessionId: args.sessionId,
      heartbeatAt: now,
    });
    const live = await liveStationsFifo(ctx, now);
    return { jobId, ...statusFor(live, jobId) };
  },
});

// Keep this render counted as live. No-op if the row was already reaped/released
// (the client treats a missing row as "proceed", so we don't resurrect it).
export const heartbeat = mutation({
  args: { jobId: v.id("renderStations") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("renderStations", args.jobId);
    if (!row) return { ok: false as const };
    await ctx.db.patch("renderStations", args.jobId, { heartbeatAt: Date.now() });
    return { ok: true as const };
  },
});

// Give up the chair. Idempotent — safe to call even if the row is already gone.
export const release = mutation({
  args: { jobId: v.id("renderStations") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("renderStations", args.jobId);
    if (row) await ctx.db.delete("renderStations", args.jobId);
    return null;
  },
});

// Reactive status for one render. The client subscribes while its render runs;
// as earlier renders finish, their rows drop and this flips queued → active.
export const status = query({
  args: { jobId: v.id("renderStations") },
  handler: async (ctx, args): Promise<StationStatus> => {
    const live = await liveStationsFifo(ctx, Date.now());
    return statusFor(live, args.jobId);
  },
});
