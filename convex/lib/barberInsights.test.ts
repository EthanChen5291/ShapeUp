import { describe, expect, test } from "vitest";
import { computeInsights } from "./barberInsights";
import type { StatBucket } from "./barberInsights";

// Fixed reference point for deterministic date math: 2024-03-15T12:00:00Z
const NOW = new Date("2024-03-15T12:00:00Z").getTime();
const DAY = 86_400_000;

/** Build a minimal StatBucket at `offsetDays` days relative to NOW. */
function makeBucket(offsetDays: number, overrides: Partial<StatBucket> = {}): StatBucket {
  const ts = NOW + offsetDays * DAY;
  return {
    bucket: new Date(ts).toISOString().slice(0, 10),
    views: 0,
    tryOns: 0,
    linkClicks: 0,
    ...overrides,
  };
}

describe("computeInsights — week boundaries", () => {
  test("empty input returns all zeros and empty topStyles", () => {
    const r = computeInsights([], NOW);
    expect(r.last7).toEqual({ views: 0, tryOns: 0, linkClicks: 0, bookingClicks: 0, selfieStarts: 0, previews: 0 });
    expect(r.prev7).toEqual({ views: 0, tryOns: 0, linkClicks: 0, bookingClicks: 0, selfieStarts: 0, previews: 0 });
    expect(r.topStyles).toEqual([]);
  });

  test("today (offset 0) lands in last7", () => {
    const r = computeInsights([makeBucket(0, { views: 5 })], NOW);
    expect(r.last7.views).toBe(5);
    expect(r.prev7.views).toBe(0);
  });

  test("6 days ago lands in last7", () => {
    const r = computeInsights([makeBucket(-6, { views: 3 })], NOW);
    expect(r.last7.views).toBe(3);
    expect(r.prev7.views).toBe(0);
  });

  test("7 days ago lands in prev7", () => {
    const r = computeInsights([makeBucket(-7, { views: 7 })], NOW);
    expect(r.last7.views).toBe(0);
    expect(r.prev7.views).toBe(7);
  });

  test("13 days ago lands in prev7", () => {
    const r = computeInsights([makeBucket(-13, { views: 2 })], NOW);
    expect(r.last7.views).toBe(0);
    expect(r.prev7.views).toBe(2);
  });

  test("14 days ago falls outside both windows", () => {
    const r = computeInsights([makeBucket(-14, { views: 9 })], NOW);
    expect(r.last7.views).toBe(0);
    expect(r.prev7.views).toBe(0);
  });

  test("correct split with data in both windows and outside", () => {
    const rows = [
      makeBucket(0, { views: 1 }),    // last7
      makeBucket(-3, { views: 2 }),   // last7
      makeBucket(-6, { views: 3 }),   // last7
      makeBucket(-7, { views: 10 }),  // prev7
      makeBucket(-10, { views: 20 }), // prev7
      makeBucket(-13, { views: 30 }), // prev7
      makeBucket(-14, { views: 99 }), // outside
    ];
    const r = computeInsights(rows, NOW);
    expect(r.last7.views).toBe(6);
    expect(r.prev7.views).toBe(60);
  });
});

describe("computeInsights — optional counters", () => {
  test("missing optional counters are treated as 0", () => {
    // Only views/tryOns/linkClicks present (the pre-redesign shape)
    const row: StatBucket = { bucket: new Date(NOW).toISOString().slice(0, 10), views: 1, tryOns: 0, linkClicks: 0 };
    const r = computeInsights([row], NOW);
    expect(r.last7.bookingClicks).toBe(0);
    expect(r.last7.selfieStarts).toBe(0);
    expect(r.last7.previews).toBe(0);
  });

  test("sums all optional counters across multiple buckets", () => {
    const rows = [
      makeBucket(0, { bookingClicks: 3, selfieStarts: 2, previews: 5 }),
      makeBucket(-1, { bookingClicks: 1, selfieStarts: 4, previews: 1 }),
    ];
    const r = computeInsights(rows, NOW);
    expect(r.last7.bookingClicks).toBe(4);
    expect(r.last7.selfieStarts).toBe(6);
    expect(r.last7.previews).toBe(6);
  });

  test("optional counters in prev7 accumulate independently of last7", () => {
    const rows = [
      makeBucket(0, { bookingClicks: 10 }),   // last7
      makeBucket(-9, { bookingClicks: 5 }),   // prev7
    ];
    const r = computeInsights(rows, NOW);
    expect(r.last7.bookingClicks).toBe(10);
    expect(r.prev7.bookingClicks).toBe(5);
  });
});

describe("computeInsights — topStyles", () => {
  test("byStyle is summed across ALL fetched buckets (not just last7/prev7)", () => {
    const rows = [
      makeBucket(0, { byStyle: { "fade": 10, "buzz": 5, "taper": 3 } }),
      makeBucket(-1, { byStyle: { "fade": 4, "blowout": 8, "crop": 2 } }),
      makeBucket(-10, { byStyle: { "caesar": 7, "buzz": 2 } }),
      makeBucket(-14, { byStyle: { "fade": 1 } }), // outside both windows — still counted
    ];
    const r = computeInsights(rows, NOW);
    const slugMap = Object.fromEntries(r.topStyles.map((s) => [s.slug, s.count]));
    expect(slugMap["fade"]).toBe(15); // 10 + 4 + 1
    expect(slugMap["buzz"]).toBe(7);  // 5 + 2
    expect(slugMap["blowout"]).toBe(8);
    expect(slugMap["caesar"]).toBe(7);
    expect(slugMap["taper"]).toBe(3);
  });

  test("topStyles is sorted descending by count", () => {
    const byStyle: Record<string, number> = { "a": 1, "b": 3, "c": 2 };
    const r = computeInsights([makeBucket(0, { byStyle })], NOW);
    expect(r.topStyles.map((s) => s.slug)).toEqual(["b", "c", "a"]);
  });

  test("topStyles is capped at 5", () => {
    const byStyle: Record<string, number> = {};
    for (let i = 0; i < 10; i++) byStyle[`style-${i}`] = 10 - i;
    const r = computeInsights([makeBucket(0, { byStyle })], NOW);
    expect(r.topStyles).toHaveLength(5);
    expect(r.topStyles[0].count).toBe(10); // style-0
  });

  test("empty byStyle produces empty topStyles", () => {
    const r = computeInsights([makeBucket(0, { byStyle: {} })], NOW);
    expect(r.topStyles).toEqual([]);
  });

  test("buckets without byStyle contribute nothing to topStyles", () => {
    const r = computeInsights([makeBucket(0, { views: 5 })], NOW);
    expect(r.topStyles).toEqual([]);
  });
});
