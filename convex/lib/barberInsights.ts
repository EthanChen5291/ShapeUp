// ============================================================
// Pure aggregation helpers for the barber dashboard's insights panel.
//
// No Convex imports — this is safe to unit-test without convex-test,
// and is also safe to import from any Convex query or mutation.
// ============================================================

export type StatBucket = {
  bucket: string; // "YYYY-MM-DD" UTC
  views: number;
  tryOns: number;
  linkClicks: number;
  bookingClicks?: number;
  selfieStarts?: number;
  previews?: number;
  byStyle?: Record<string, number>;
};

export type WeekSummary = {
  views: number;
  tryOns: number;
  linkClicks: number;
  bookingClicks: number;
  selfieStarts: number;
  previews: number;
};

export type Insights = {
  last7: WeekSummary;
  prev7: WeekSummary;
  topStyles: { slug: string; count: number }[];
};

function dayBucket(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

const ZERO_WEEK: WeekSummary = {
  views: 0,
  tryOns: 0,
  linkClicks: 0,
  bookingClicks: 0,
  selfieStarts: 0,
  previews: 0,
};

function addToWeek(acc: WeekSummary, row: StatBucket): WeekSummary {
  return {
    views: acc.views + row.views,
    tryOns: acc.tryOns + row.tryOns,
    linkClicks: acc.linkClicks + row.linkClicks,
    bookingClicks: acc.bookingClicks + (row.bookingClicks ?? 0),
    selfieStarts: acc.selfieStarts + (row.selfieStarts ?? 0),
    previews: acc.previews + (row.previews ?? 0),
  };
}

/**
 * Compute the barber dashboard insights from an array of daily stat buckets.
 *
 * @param buckets  Rows from `barberPageStats`, any order (the function handles
 *                 it). Typically the last ≤90 days, desc-ordered from the DB.
 * @param now      Current timestamp in ms (injected for testability).
 *
 * Week definitions (UTC calendar days, matching `dayBucket()`):
 *   last7  = today through 6 days ago (inclusive)
 *   prev7  = 7 days ago through 13 days ago (inclusive)
 *   topStyles = byStyle summed across ALL buckets, sorted desc, top 5
 */
export function computeInsights(buckets: StatBucket[], now: number): Insights {
  const todayBucket = dayBucket(now);
  const last7Start = dayBucket(now - 6 * 86_400_000);
  const prev7End = dayBucket(now - 7 * 86_400_000);
  const prev7Start = dayBucket(now - 13 * 86_400_000);

  let last7: WeekSummary = { ...ZERO_WEEK };
  let prev7: WeekSummary = { ...ZERO_WEEK };
  const styleMap: Record<string, number> = {};

  for (const row of buckets) {
    // Accumulate byStyle totals across ALL fetched buckets.
    if (row.byStyle) {
      for (const [slug, count] of Object.entries(row.byStyle)) {
        styleMap[slug] = (styleMap[slug] ?? 0) + count;
      }
    }

    // Week aggregations use string comparison — valid for ISO date strings.
    if (row.bucket >= last7Start && row.bucket <= todayBucket) {
      last7 = addToWeek(last7, row);
    } else if (row.bucket >= prev7Start && row.bucket <= prev7End) {
      prev7 = addToWeek(prev7, row);
    }
  }

  const topStyles = Object.entries(styleMap)
    .map(([slug, count]) => ({ slug, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { last7, prev7, topStyles };
}
