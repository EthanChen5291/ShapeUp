/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { upcomingDays, type BookingConfig } from "./lib/bookingSlots";

const modules = import.meta.glob("./**/*.ts");

function identity(t: ReturnType<typeof convexTest>, clerkId: string) {
  return t.withIdentity({
    subject: clerkId,
    tokenIdentifier: `https://clerk.test|${clerkId}`,
    email: `${clerkId}@example.com`,
    nickname: clerkId,
  });
}

async function user(t: ReturnType<typeof convexTest>, clerkId: string) {
  const who = identity(t, clerkId);
  await who.mutation(api.users.getOrCreate, {});
  return who;
}

// Open every day so "the next bookable slot" always exists regardless of when
// the test runs; UTC so the assertions don't depend on the machine's zone.
const BOOKING = {
  enabled: true,
  timezone: "UTC",
  slotMinutes: 30,
  days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: "09:00", end: "17:00" })),
};

const CARD = {
  slug: "marcus",
  displayName: "Marcus",
  shopName: "Fade Theory",
  links: [],
  styles: [],
  published: true,
  services: [{ name: "Skin fade", price: "$40" }],
  booking: BOOKING,
};

function nextOpenSlot(booked: { startMs: number; endMs: number }[] = []): number {
  const days = upcomingDays(BOOKING as BookingConfig, Date.now(), booked);
  for (const day of days) {
    if (day.slotStartsMs.length) return day.slotStartsMs[0];
  }
  throw new Error("no open slot in horizon");
}

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getAvailability", () => {
  test("returns null for unknown pages and pages with booking off", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.barberBooking.getAvailability, { slug: "nobody" })).toBeNull();

    const marcus = await user(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, {
      ...CARD,
      booking: { ...BOOKING, enabled: false, days: [] },
    });
    expect(await t.query(api.barberBooking.getAvailability, { slug: "marcus" })).toBeNull();
  });

  test("exposes the schedule and booked intervals — anonymously, without client identity", async () => {
    const t = convexTest(schema, modules);
    const marcus = await user(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);

    const client = await user(t, "client1");
    const slot = nextOpenSlot();
    await client.mutation(api.barberBooking.book, {
      slug: "marcus",
      startMs: slot,
      clientName: "Dre",
    });

    const availability = await t.query(api.barberBooking.getAvailability, { slug: "marcus" });
    expect(availability).toMatchObject({ timezone: "UTC", slotMinutes: 30 });
    expect(availability!.days).toHaveLength(7);
    expect(availability!.booked).toContainEqual({ startMs: slot, endMs: slot + 30 * 60_000 });
    // Intervals only — nothing about who booked.
    expect(JSON.stringify(availability)).not.toContain("Dre");
  });
});

describe("book", () => {
  test("requires sign-in", async () => {
    const t = convexTest(schema, modules);
    const marcus = await user(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);
    await expect(
      t.mutation(api.barberBooking.book, {
        slug: "marcus",
        startMs: nextOpenSlot(),
        clientName: "Dre",
      }),
    ).rejects.toThrow(/sign in/i);
  });

  test("rejects an off-grid time", async () => {
    const t = convexTest(schema, modules);
    const marcus = await user(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);
    const client = await user(t, "client1");
    await expect(
      client.mutation(api.barberBooking.book, {
        slug: "marcus",
        startMs: nextOpenSlot() + 10 * 60_000,
        clientName: "Dre",
      }),
    ).rejects.toThrow(/isn't available/i);
  });

  test("books a slot, then refuses the same slot to the next client", async () => {
    const t = convexTest(schema, modules);
    const marcus = await user(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);

    const slot = nextOpenSlot();
    const dre = await user(t, "client1");
    const result = await dre.mutation(api.barberBooking.book, {
      slug: "marcus",
      startMs: slot,
      clientName: "Dre",
      service: "Skin fade",
      note: "walk-in friendly?",
    });
    expect(result).toEqual({ startMs: slot, endMs: slot + 30 * 60_000 });

    const kay = await user(t, "client2");
    await expect(
      kay.mutation(api.barberBooking.book, { slug: "marcus", startMs: slot, clientName: "Kay" }),
    ).rejects.toThrow(/just took that time/i);

    const bookings = await marcus.query(api.barberBooking.listMyBookings, {});
    expect(bookings).toHaveLength(1);
    expect(bookings![0]).toMatchObject({
      clientName: "Dre",
      clientEmail: "client1@example.com",
      service: "Skin fade",
      note: "walk-in friendly?",
      startMs: slot,
    });
  });

  test("ignores a service that isn't on the barber's menu", async () => {
    const t = convexTest(schema, modules);
    const marcus = await user(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);
    const client = await user(t, "client1");
    await client.mutation(api.barberBooking.book, {
      slug: "marcus",
      startMs: nextOpenSlot(),
      clientName: "Dre",
      service: "Free haircut forever",
    });
    const bookings = await marcus.query(api.barberBooking.listMyBookings, {});
    expect(bookings![0].service).toBeUndefined();
  });

  test("refuses bookings when the page is unpublished or booking is disabled", async () => {
    const t = convexTest(schema, modules);
    const marcus = await user(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, { ...CARD, published: false });
    const client = await user(t, "client1");
    await expect(
      client.mutation(api.barberBooking.book, {
        slug: "marcus",
        startMs: nextOpenSlot(),
        clientName: "Dre",
      }),
    ).rejects.toThrow(/isn't taking bookings/i);
  });
});

describe("cancel", () => {
  test("only the owner can cancel, and cancelling frees the slot", async () => {
    const t = convexTest(schema, modules);
    const marcus = await user(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);

    const slot = nextOpenSlot();
    const dre = await user(t, "client1");
    await dre.mutation(api.barberBooking.book, { slug: "marcus", startMs: slot, clientName: "Dre" });

    const bookings = await marcus.query(api.barberBooking.listMyBookings, {});
    const bookingId = bookings![0].id;

    const rival = await user(t, "rival");
    await rival.mutation(api.barberPages.upsert, { ...CARD, slug: "rival", displayName: "Rival" });
    await expect(rival.mutation(api.barberBooking.cancel, { bookingId })).rejects.toThrow(
      /not found/i,
    );

    await marcus.mutation(api.barberBooking.cancel, { bookingId });
    expect(await marcus.query(api.barberBooking.listMyBookings, {})).toHaveLength(0);

    // The slot is bookable again.
    const kay = await user(t, "client2");
    await kay.mutation(api.barberBooking.book, { slug: "marcus", startMs: slot, clientName: "Kay" });
  });
});

describe("barberPages booking config", () => {
  test("upsert rejects an invalid booking config", async () => {
    const t = convexTest(schema, modules);
    const marcus = await user(t, "marcus");
    await expect(
      marcus.mutation(api.barberPages.upsert, {
        ...CARD,
        booking: { ...BOOKING, timezone: "Mars/Olympus" },
      }),
    ).rejects.toThrow(/timezone/i);
  });

  test("getBySlug exposes booking only when enabled", async () => {
    const t = convexTest(schema, modules);
    const marcus = await user(t, "marcus");
    await marcus.mutation(api.barberPages.upsert, CARD);
    const page = await t.query(api.barberPages.getBySlug, { slug: "marcus" });
    expect(page!.booking).toMatchObject({ timezone: "UTC", slotMinutes: 30 });

    await marcus.mutation(api.barberPages.upsert, {
      ...CARD,
      booking: { ...BOOKING, enabled: false },
    });
    const off = await t.query(api.barberPages.getBySlug, { slug: "marcus" });
    expect(off!.booking).toBeUndefined();
  });
});
