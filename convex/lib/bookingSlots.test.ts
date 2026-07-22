import { describe, expect, test } from "vitest";
import {
  MAX_BOOKING_DAYS_AHEAD,
  MIN_LEAD_MS,
  dateISOInZone,
  isOfferedSlot,
  isValidTimeZone,
  normalizeBookingConfig,
  slotsForDate,
  upcomingDays,
  weekdayOfDateISO,
  zonedTimeToUtc,
  type BookingConfig,
} from "./bookingSlots";

// A Tuesday-through-Saturday shop in LA, 30-minute chairs.
const LA_CONFIG: BookingConfig = {
  enabled: true,
  timezone: "America/Los_Angeles",
  slotMinutes: 30,
  days: [2, 3, 4, 5, 6].map((day) => ({ day, start: "09:00", end: "12:00" })),
};

describe("zonedTimeToUtc", () => {
  test("converts a PST wall time (UTC-8)", () => {
    // 2026-01-13 is a Tuesday; LA is UTC-8 in January.
    expect(zonedTimeToUtc("2026-01-13", "09:00", "America/Los_Angeles")).toBe(
      Date.UTC(2026, 0, 13, 17, 0),
    );
  });

  test("converts a PDT wall time (UTC-7) — DST tracked, not hardcoded", () => {
    // 2026-07-14 is a Tuesday; LA is UTC-7 in July.
    expect(zonedTimeToUtc("2026-07-14", "09:00", "America/Los_Angeles")).toBe(
      Date.UTC(2026, 6, 14, 16, 0),
    );
  });

  test("handles zones east of Greenwich", () => {
    expect(zonedTimeToUtc("2026-07-14", "09:00", "Europe/Madrid")).toBe(
      Date.UTC(2026, 6, 14, 7, 0),
    );
  });
});

describe("dateISOInZone / weekdayOfDateISO", () => {
  test("an instant late at night UTC is still the previous day in LA", () => {
    const utcMidnightish = Date.UTC(2026, 6, 15, 3, 0); // July 15 03:00 UTC
    expect(dateISOInZone(utcMidnightish, "America/Los_Angeles")).toBe("2026-07-14");
    expect(weekdayOfDateISO("2026-07-14")).toBe(2); // Tuesday
  });
});

describe("slotsForDate", () => {
  // "Now" = Monday July 13 2026, noon UTC (5am LA) — the shop days are ahead.
  const NOW = Date.UTC(2026, 6, 13, 12, 0);

  test("generates the slot grid inside the day's window", () => {
    const starts = slotsForDate(LA_CONFIG, "2026-07-14", NOW);
    expect(starts).toHaveLength(6); // 09:00–12:00 at 30min
    expect(starts[0]).toBe(zonedTimeToUtc("2026-07-14", "09:00", LA_CONFIG.timezone));
    expect(starts[5]).toBe(zonedTimeToUtc("2026-07-14", "11:30", LA_CONFIG.timezone));
  });

  test("a closed weekday has no slots", () => {
    expect(slotsForDate(LA_CONFIG, "2026-07-13", NOW)).toEqual([]); // Monday
  });

  test("drops slots that start before now + lead time", () => {
    const nineAm = zonedTimeToUtc("2026-07-14", "09:00", LA_CONFIG.timezone);
    // "Now" is 09:20; with the 45-minute lead the earliest start is 10:05,
    // so 10:30 is the first slot still on offer.
    expect(MIN_LEAD_MS).toBe(45 * 60_000);
    const starts = slotsForDate(LA_CONFIG, "2026-07-14", nineAm + 20 * 60_000);
    expect(starts[0]).toBe(zonedTimeToUtc("2026-07-14", "10:30", LA_CONFIG.timezone));
  });

  test("drops slots overlapping an existing booking", () => {
    const tenAm = zonedTimeToUtc("2026-07-14", "10:00", LA_CONFIG.timezone);
    const starts = slotsForDate(LA_CONFIG, "2026-07-14", NOW, [
      { startMs: tenAm, endMs: tenAm + 30 * 60_000 },
    ]);
    expect(starts).not.toContain(tenAm);
    expect(starts).toHaveLength(5);
  });

  test("a slot that would run past closing is not offered", () => {
    const cfg: BookingConfig = { ...LA_CONFIG, slotMinutes: 45 };
    const starts = slotsForDate(cfg, "2026-07-14", NOW);
    const last = starts[starts.length - 1];
    const close = zonedTimeToUtc("2026-07-14", "12:00", cfg.timezone);
    expect(last + 45 * 60_000).toBeLessThanOrEqual(close);
  });
});

describe("upcomingDays", () => {
  test("covers the horizon, skipping closed days, starting from the barber's today", () => {
    const NOW = Date.UTC(2026, 6, 13, 12, 0); // Monday
    const days = upcomingDays(LA_CONFIG, NOW);
    expect(days.length).toBeGreaterThan(0);
    expect(days.length).toBeLessThanOrEqual(MAX_BOOKING_DAYS_AHEAD);
    expect(days[0].dateISO).toBe("2026-07-14"); // Monday closed → Tuesday first
    for (const d of days) {
      expect([2, 3, 4, 5, 6]).toContain(d.weekday);
    }
  });
});

describe("isOfferedSlot", () => {
  const NOW = Date.UTC(2026, 6, 13, 12, 0);

  test("accepts an exact on-grid slot", () => {
    const s = zonedTimeToUtc("2026-07-14", "09:30", LA_CONFIG.timezone);
    expect(isOfferedSlot(LA_CONFIG, s, NOW)).toBe(true);
  });

  test("rejects off-grid, past-horizon, closed-day, and disabled requests", () => {
    const offGrid = zonedTimeToUtc("2026-07-14", "09:10", LA_CONFIG.timezone);
    expect(isOfferedSlot(LA_CONFIG, offGrid, NOW)).toBe(false);

    const monday = zonedTimeToUtc("2026-07-13", "09:00", LA_CONFIG.timezone);
    expect(isOfferedSlot(LA_CONFIG, monday, NOW)).toBe(false);

    const farOut = zonedTimeToUtc("2026-09-01", "09:00", LA_CONFIG.timezone);
    expect(isOfferedSlot(LA_CONFIG, farOut, NOW)).toBe(false);

    const s = zonedTimeToUtc("2026-07-14", "09:30", LA_CONFIG.timezone);
    expect(isOfferedSlot({ ...LA_CONFIG, enabled: false }, s, NOW)).toBe(false);
  });
});

describe("normalizeBookingConfig", () => {
  const RAW = {
    enabled: true,
    timezone: "America/Los_Angeles",
    slotMinutes: 30,
    days: [{ day: 2, start: "09:00", end: "18:00" }],
  };

  test("accepts and sorts a valid config", () => {
    const result = normalizeBookingConfig({
      ...RAW,
      price: "  $45  ",
      days: [
        { day: 5, start: "10:00", end: "16:00" },
        { day: 2, start: "09:00", end: "18:00" },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.days.map((d) => d.day)).toEqual([2, 5]);
      expect(result.config.price).toBe("$45");
    }
  });

  test.each([
    [{ ...RAW, timezone: "Mars/Olympus" }, /timezone/i],
    [{ ...RAW, slotMinutes: 7 }, /slot length/i],
    [{ ...RAW, days: [{ day: 9, start: "09:00", end: "18:00" }] }, /sunday through saturday/i],
    [
      {
        ...RAW,
        days: [
          { day: 2, start: "09:00", end: "12:00" },
          { day: 2, start: "13:00", end: "18:00" },
        ],
      },
      /one window per day/i,
    ],
    [{ ...RAW, days: [{ day: 2, start: "9am", end: "18:00" }] }, /09:00/],
    [{ ...RAW, days: [{ day: 2, start: "18:00", end: "09:00" }] }, /open before it closes/i],
    [{ ...RAW, days: [] }, /at least one open day/i],
  ])("rejects bad input: %j", (raw, message) => {
    const result = normalizeBookingConfig(raw as typeof RAW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });

  test("a disabled config may have zero days (nothing to offer, nothing to check)", () => {
    expect(normalizeBookingConfig({ ...RAW, enabled: false, days: [] }).ok).toBe(true);
  });
});

describe("isValidTimeZone", () => {
  test("accepts IANA names and rejects junk", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});
