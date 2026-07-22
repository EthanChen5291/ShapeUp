// ============================================================
// Native appointment slots — the pure math, shared by both sides.
//
// The barber writes weekly hours in their own timezone ("Tue 09:00–18:00 in
// America/Los_Angeles"); a client anywhere in the world needs those turned
// into concrete UTC instants they can tap. Everything here is pure and
// dependency-free (timezone conversion rides on Intl, which both the Convex
// default runtime and every browser ship), so the public card can compute the
// same slot grid the server validates against — the server is the authority,
// the client is a preview of it.
//
// Defined server-side and re-exported to the app via src/lib/bookingSlots.ts,
// the same arrangement as convex/lib/barberLinks.ts.
// ============================================================

/** Slot lengths the builder offers. Anything else is rejected at write time. */
export const SLOT_MINUTES_OPTIONS = [15, 20, 30, 45, 60] as const;

/** How far ahead a client can book. Enough for "next week", not a calendar app. */
export const MAX_BOOKING_DAYS_AHEAD = 14;

/** A slot must start at least this far in the future — no ambush bookings. */
export const MIN_LEAD_MS = 45 * 60 * 1000;

export interface BookingDay {
  /** 0 (Sunday) – 6 (Saturday). */
  day: number;
  /** "HH:MM", 24h, in the barber's timezone. */
  start: string;
  end: string;
}

export interface BookingConfig {
  enabled: boolean;
  timezone: string;
  slotMinutes: number;
  /** Barber-entered display price, e.g. "$45". ShapeUp does not collect payment. */
  price?: string;
  days: BookingDay[];
}

export interface BookedInterval {
  startMs: number;
  endMs: number;
}

export interface DaySlots {
  /** "YYYY-MM-DD" in the barber's timezone. */
  dateISO: string;
  /** 0–6, matching BookingDay.day. */
  weekday: number;
  /** UTC epoch starts of the still-open slots, ascending. */
  slotStartsMs: number[];
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ── timezone plumbing ──
// Intl only converts instant → wall clock. The other direction (wall clock in
// a zone → instant) is done with the standard two-pass trick: guess the
// instant as if the wall time were UTC, measure the zone's offset at that
// guess, correct, and re-measure once so a DST boundary between guess and
// answer lands on the right side.

interface WallClock {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
  hour: number;
  minute: number;
}

const wallClockFormatters = new Map<string, Intl.DateTimeFormat>();

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = wallClockFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23", // never "24:xx" at midnight
    });
    wallClockFormatters.set(timeZone, fmt);
  }
  return fmt;
}

function wallClockAt(epochMs: number, timeZone: string): WallClock {
  const parts = wallClockFormatter(timeZone).formatToParts(new Date(epochMs));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/** The zone's UTC offset (ms) at a given instant. Positive east of Greenwich. */
function offsetAt(epochMs: number, timeZone: string): number {
  const w = wallClockAt(epochMs, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  // Compare at minute precision — wall clocks don't carry seconds here.
  return asUtc - Math.floor(epochMs / 60_000) * 60_000;
}

/** The instant when a zone's wall clock reads `dateISO` `time`. */
export function zonedTimeToUtc(dateISO: string, time: string, timeZone: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const once = guess - offsetAt(guess, timeZone);
  return guess - offsetAt(once, timeZone);
}

/** "YYYY-MM-DD" of an instant, as the zone's wall calendar reads it. */
export function dateISOInZone(epochMs: number, timeZone: string): string {
  const w = wallClockAt(epochMs, timeZone);
  const mm = String(w.month).padStart(2, "0");
  const dd = String(w.day).padStart(2, "0");
  return `${w.year}-${mm}-${dd}`;
}

/** Weekday (0=Sun) of a calendar date — pure calendar math, no zone needed. */
export function weekdayOfDateISO(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The calendar date `days` after `dateISO`. */
function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${t.getUTCFullYear()}-${mm}-${dd}`;
}

function overlaps(aStart: number, aEnd: number, b: BookedInterval): boolean {
  return aStart < b.endMs && aEnd > b.startMs;
}

/**
 * The open slots for one calendar day in the barber's zone: every
 * `slotMinutes` step inside that weekday's window, minus slots that already
 * started (plus lead time) and slots overlapping an existing booking.
 */
export function slotsForDate(
  config: BookingConfig,
  dateISO: string,
  nowMs: number,
  booked: BookedInterval[] = [],
): number[] {
  const weekday = weekdayOfDateISO(dateISO);
  const slotMs = config.slotMinutes * 60_000;
  const earliest = nowMs + MIN_LEAD_MS;
  const starts: number[] = [];
  for (const window of config.days) {
    if (window.day !== weekday) continue;
    const open = zonedTimeToUtc(dateISO, window.start, config.timezone);
    const close = zonedTimeToUtc(dateISO, window.end, config.timezone);
    for (let s = open; s + slotMs <= close; s += slotMs) {
      if (s < earliest) continue;
      if (booked.some((b) => overlaps(s, s + slotMs, b))) continue;
      starts.push(s);
    }
  }
  return starts.sort((a, b) => a - b);
}

/**
 * The bookable horizon: today (barber's calendar) through
 * MAX_BOOKING_DAYS_AHEAD, one entry per day that has at least a window
 * configured — empty-slot days are kept so the picker can say "full" rather
 * than silently hiding a workday.
 */
export function upcomingDays(
  config: BookingConfig,
  nowMs: number,
  booked: BookedInterval[] = [],
): DaySlots[] {
  const today = dateISOInZone(nowMs, config.timezone);
  const workdays = new Set(config.days.map((d) => d.day));
  const out: DaySlots[] = [];
  for (let i = 0; i < MAX_BOOKING_DAYS_AHEAD; i++) {
    const dateISO = addDaysISO(today, i);
    const weekday = weekdayOfDateISO(dateISO);
    if (!workdays.has(weekday)) continue;
    out.push({
      dateISO,
      weekday,
      slotStartsMs: slotsForDate(config, dateISO, nowMs, booked),
    });
  }
  return out;
}

/**
 * Server-side check for a booking request: is `startMs` exactly one of the
 * slots this config offers right now? (Conflicts with existing bookings are
 * the mutation's job — it holds the transaction.)
 */
export function isOfferedSlot(config: BookingConfig, startMs: number, nowMs: number): boolean {
  if (!config.enabled) return false;
  if (startMs > nowMs + MAX_BOOKING_DAYS_AHEAD * 24 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000) {
    return false; // beyond the horizon even before slot math
  }
  const dateISO = dateISOInZone(startMs, config.timezone);
  return slotsForDate(config, dateISO, nowMs).includes(startMs);
}

export type BookingConfigCheck =
  | { ok: true; config: BookingConfig }
  | { ok: false; error: string };

/**
 * Validate + normalize a builder-submitted config. Server-authoritative: the
 * builder runs the same function for live feedback, but barberPages.upsert is
 * the write that counts.
 */
export function normalizeBookingConfig(raw: {
  enabled: boolean;
  timezone: string;
  slotMinutes: number;
  price?: string;
  days: { day: number; start: string; end: string }[];
}): BookingConfigCheck {
  if (!isValidTimeZone(raw.timezone)) {
    return { ok: false, error: "That timezone isn't recognized." };
  }
  if (!(SLOT_MINUTES_OPTIONS as readonly number[]).includes(raw.slotMinutes)) {
    return { ok: false, error: "Pick a slot length from the list." };
  }
  if (raw.days.length > 7) {
    return { ok: false, error: "At most one window per day of the week." };
  }
  const seen = new Set<number>();
  for (const d of raw.days) {
    if (!Number.isInteger(d.day) || d.day < 0 || d.day > 6) {
      return { ok: false, error: "Days must be Sunday through Saturday." };
    }
    if (seen.has(d.day)) {
      return { ok: false, error: "At most one window per day of the week." };
    }
    seen.add(d.day);
    if (!TIME_RE.test(d.start) || !TIME_RE.test(d.end)) {
      return { ok: false, error: "Hours must look like 09:00." };
    }
    if (d.start >= d.end) {
      return { ok: false, error: "Each day must open before it closes." };
    }
  }
  if (raw.enabled && raw.days.length === 0) {
    return { ok: false, error: "Add at least one open day to take bookings." };
  }
  return {
    ok: true,
    config: {
      enabled: raw.enabled,
      timezone: raw.timezone,
      slotMinutes: raw.slotMinutes,
      price: raw.price?.trim().slice(0, 20) || undefined,
      days: [...raw.days]
        .sort((a, b) => a.day - b.day)
        .map((d) => ({ day: d.day, start: d.start, end: d.end })),
    },
  };
}
