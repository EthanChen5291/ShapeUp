// ============================================================
// Native appointments on a barber card — /b/<slug>'s "pick a time".
//
// The barber writes weekly hours into barberPages.booking (via
// barberPages.upsert); this file turns them into bookable slots and owns the
// barberBookings rows. No calendar OAuth anywhere: the booking lands on real
// calendars through the Google-Calendar template link + .ics attachment in
// the confirmation emails (convex/lib/calendarLinks.ts).
//
// Trust model, matching the rest of the card:
//  - getAvailability is PUBLIC: a logged-out stranger must be able to see
//    open times. It returns booked intervals only — never who booked them.
//  - book requires a signed-in client (same bar as the try-on flow), is
//    rate-limited per user, and re-validates the requested slot against the
//    same pure slot math the card used to render it (convex/lib/bookingSlots).
//    The overlap check runs inside the mutation's transaction, so two clients
//    tapping the same slot can't both win.
//  - listMyBookings / cancel are owner-scoped.
// ============================================================

import { ConvexError, v } from "convex/values";
import {
  internalAction,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { normalizeSlug } from "./lib/barberLinks";
import { enforceMutationRateLimit } from "./lib/rateLimit";
import {
  MAX_BOOKING_DAYS_AHEAD,
  isOfferedSlot,
  type BookingConfig,
} from "./lib/bookingSlots";
import { buildIcs } from "./lib/calendarLinks";
import {
  buildBookingBarberEmail,
  buildBookingClientEmail,
  type BookingEmailInput,
} from "./lib/barberEmail";

const MAX_NAME = 80;
const MAX_NOTE = 300;

async function requireUser(ctx: MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in to book a time.");
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError("User not found.");
  return user;
}

/** Booked (not cancelled) intervals near the bookable horizon for a page. */
async function bookedIntervals(
  ctx: { db: QueryCtx["db"] },
  pageId: Id<"barberPages">,
  fromMs: number,
  toMs: number,
): Promise<{ startMs: number; endMs: number }[]> {
  const rows = await ctx.db
    .query("barberBookings")
    .withIndex("by_page_and_start", (q) =>
      q.eq("pageId", pageId).gte("startMs", fromMs).lt("startMs", toMs),
    )
    .take(1000);
  return rows
    .filter((r) => r.status === "booked")
    .map((r) => ({ startMs: r.startMs, endMs: r.endMs }));
}

// ── public ──────────────────────────────────────────────────

/**
 * What a visitor needs to render the slot picker: the barber's live schedule
 * config plus which intervals are already taken. Anonymous by design; returns
 * null when the page is missing, unpublished, or has booking off.
 */
export const getAvailability = query({
  args: { slug: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    timezone: string;
    slotMinutes: number;
    days: { day: number; start: string; end: string }[];
    booked: { startMs: number; endMs: number }[];
  } | null> => {
    const normalized = normalizeSlug(args.slug);
    if (!normalized.ok) return null;
    const page = await ctx.db
      .query("barberPages")
      .withIndex("by_slug", (q) => q.eq("slug", normalized.slug))
      .unique();
    if (!page || !page.published || !page.booking?.enabled) return null;

    const now = Date.now();
    const horizon = now + (MAX_BOOKING_DAYS_AHEAD + 1) * 24 * 60 * 60 * 1000;
    const booked = await bookedIntervals(ctx, page._id, now - 24 * 60 * 60 * 1000, horizon);
    return {
      timezone: page.booking.timezone,
      slotMinutes: page.booking.slotMinutes,
      days: page.booking.days,
      booked,
    };
  },
});

/** Claim a slot. Signed-in clients only — same bar as the try-on itself. */
export const book = mutation({
  args: {
    slug: v.string(),
    startMs: v.number(),
    clientName: v.string(),
    clientPhone: v.optional(v.string()),
    service: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ startMs: number; endMs: number }> => {
    const user = await requireUser(ctx);
    await enforceMutationRateLimit(ctx, `barberBook:${user._id}`, 5, 60_000);

    const clientName = args.clientName.trim().slice(0, MAX_NAME);
    if (!clientName) throw new ConvexError("Add your name so the barber knows who's coming.");

    const normalized = normalizeSlug(args.slug);
    if (!normalized.ok) throw new ConvexError("That page doesn't exist.");
    const page = await ctx.db
      .query("barberPages")
      .withIndex("by_slug", (q) => q.eq("slug", normalized.slug))
      .unique();
    if (!page || !page.published || !page.booking?.enabled) {
      throw new ConvexError("This barber isn't taking bookings here right now.");
    }
    const config: BookingConfig = page.booking;

    const now = Date.now();
    if (!isOfferedSlot(config, args.startMs, now)) {
      throw new ConvexError("That time isn't available — pick another slot.");
    }
    const endMs = args.startMs + config.slotMinutes * 60_000;

    // Conflict check inside the transaction: any overlapping live booking wins.
    const nearby = await bookedIntervals(
      ctx,
      page._id,
      args.startMs - 2 * 60 * 60 * 1000,
      endMs,
    );
    if (nearby.some((b) => args.startMs < b.endMs && endMs > b.startMs)) {
      throw new ConvexError("Someone just took that time — pick another slot.");
    }

    const service = args.service?.trim().slice(0, 60) || undefined;
    // Only offer services that are actually on the menu.
    const knownService =
      service && page.services?.some((s) => s.name === service) ? service : undefined;

    const bookingId = await ctx.db.insert("barberBookings", {
      pageId: page._id,
      startMs: args.startMs,
      endMs,
      clientUserId: user._id,
      clientName,
      clientEmail: user.email,
      clientPhone: args.clientPhone?.trim().slice(0, 30) || undefined,
      service: knownService,
      note: args.note?.trim().slice(0, MAX_NOTE) || undefined,
      status: "booked",
      createdAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.barberBooking.sendBookingEmails, {
      bookingId,
      kind: "booked",
    });

    return { startMs: args.startMs, endMs };
  },
});

// ── owner ───────────────────────────────────────────────────

/** Upcoming appointments for the signed-in barber's own card. */
export const listMyBookings = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;
    const page = await ctx.db
      .query("barberPages")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", user._id))
      .first();
    if (!page) return null;

    const rows = await ctx.db
      .query("barberBookings")
      .withIndex("by_page_and_start", (q) =>
        q.eq("pageId", page._id).gte("startMs", Date.now() - 2 * 60 * 60 * 1000),
      )
      .take(100);
    return rows
      .filter((r) => r.status === "booked")
      .map((r) => ({
        id: r._id,
        startMs: r.startMs,
        endMs: r.endMs,
        clientName: r.clientName,
        clientEmail: r.clientEmail,
        clientPhone: r.clientPhone,
        service: r.service,
        note: r.note,
      }));
  },
});

/** Cancel an appointment on your own card; frees the slot, emails the client. */
export const cancel = mutation({
  args: { bookingId: v.id("barberBookings") },
  handler: async (ctx, args): Promise<null> => {
    const user = await requireUser(ctx);
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) throw new ConvexError("Booking not found.");
    const page = await ctx.db.get(booking.pageId);
    if (!page || page.ownerUserId !== user._id) throw new ConvexError("Booking not found.");
    if (booking.status === "cancelled") return null;

    await ctx.db.patch(booking._id, { status: "cancelled" });
    await ctx.scheduler.runAfter(0, internal.barberBooking.sendBookingEmails, {
      bookingId: booking._id,
      kind: "cancelled",
    });
    return null;
  },
});

// ── notification emails (best-effort, never blocks the booking) ──

export const getBookingForEmail = internalQuery({
  args: { bookingId: v.id("barberBookings") },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) return null;
    const page = await ctx.db.get(booking.pageId);
    if (!page) return null;
    return {
      booking: {
        startMs: booking.startMs,
        endMs: booking.endMs,
        clientName: booking.clientName,
        clientEmail: booking.clientEmail,
        clientPhone: booking.clientPhone,
        service: booking.service,
        note: booking.note,
      },
      page: {
        displayName: page.displayName,
        shopName: page.shopName,
        location: page.location,
        contactEmail: page.contactEmail,
        timezone: page.booking?.timezone ?? "UTC",
      },
    };
  },
});

// The Convex runtime has no Buffer; the .ics attachment is ASCII, so a tiny
// base64 encoder keeps this file off the Node runtime.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64Ascii(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i += 3) {
    const a = s.charCodeAt(i);
    const b = i + 1 < s.length ? s.charCodeAt(i + 1) : NaN;
    const c = i + 2 < s.length ? s.charCodeAt(i + 2) : NaN;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (Number.isNaN(b) ? 0 : b >> 4)];
    out += Number.isNaN(b) ? "=" : B64[((b & 15) << 2) | (Number.isNaN(c) ? 0 : c >> 6)];
    out += Number.isNaN(c) ? "=" : B64[c & 63];
  }
  return out;
}

export const sendBookingEmails = internalAction({
  args: {
    bookingId: v.id("barberBookings"),
    kind: v.union(v.literal("booked"), v.literal("cancelled")),
  },
  handler: async (ctx, args): Promise<null> => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn("[barberBooking] No RESEND_API_KEY set — booking saved, emails skipped");
      return null;
    }
    const data = await ctx.runQuery(internal.barberBooking.getBookingForEmail, {
      bookingId: args.bookingId,
    });
    if (!data) return null;

    const input: BookingEmailInput = {
      barberName: data.page.displayName,
      shopName: data.page.shopName,
      location: data.page.location,
      clientName: data.booking.clientName,
      clientEmail: data.booking.clientEmail,
      clientPhone: data.booking.clientPhone,
      service: data.booking.service,
      note: data.booking.note,
      startMs: data.booking.startMs,
      endMs: data.booking.endMs,
      timezone: data.page.timezone,
      cancelled: args.kind === "cancelled",
    };

    const ics = buildIcs({
      uid: `${args.bookingId}@tryshapeup.cc`,
      title: `Haircut — ${data.booking.clientName} with ${data.page.displayName}`,
      details: [data.booking.service, data.booking.note, "Booked via ShapeUp"]
        .filter(Boolean)
        .join(" · "),
      location: data.page.location ?? data.page.shopName,
      startMs: data.booking.startMs,
      endMs: data.booking.endMs,
    });
    const attachments =
      args.kind === "booked"
        ? [{ filename: "appointment.ics", content: base64Ascii(ics) }]
        : undefined;

    const from = process.env.RESEND_FROM_EMAIL ?? "ShapeUp <notifications@tryshapeup.cc>";
    const deliveries: { to: string; subject: string; html: string }[] = [];
    if (data.page.contactEmail) {
      deliveries.push({ to: data.page.contactEmail, ...buildBookingBarberEmail(input) });
    }
    if (data.booking.clientEmail) {
      deliveries.push({ to: data.booking.clientEmail, ...buildBookingClientEmail(input) });
    }

    for (const d of deliveries) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: d.to, subject: d.subject, html: d.html, attachments }),
      });
      if (!res.ok) {
        console.error(
          "[barberBooking] Resend send failed:",
          res.status,
          await res.text().catch(() => ""),
        );
      }
    }
    return null;
  },
});
