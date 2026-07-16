// ============================================================
// Barber cards — /b/<slug>
//
// A free link-in-bio for a barber, whose hero block is a menu of the cuts they
// do. A client scans the QR taped to the mirror, taps a cut, and sees it on
// their own head — with the barber's referral code carried along, so every
// client they send us is attributed back to them.
//
// Trust model:
//  - getBySlug / recordEvent are PUBLIC and unauthenticated (the whole point is
//    a logged-out stranger with a phone camera). They follow the convention set
//    by contact.submitMessage: validate hard, rate-limit, never trust input.
//  - upsert is authed and owner-scoped. Everything it stores is re-normalized
//    server-side through convex/lib/barberLinks.ts — the builder's validation is
//    a convenience, not a control.
// ============================================================

import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { enforceMutationRateLimit } from "./lib/rateLimit";
import { uniqueReferralCode } from "./lib/referrals";
import {
  MAX_LINKS,
  MAX_STYLES,
  normalizeBarberLink,
  normalizeSlug,
} from "./lib/barberLinks";
import { computeInsights } from "./lib/barberInsights";
import { normalizeBookingConfig, type BookingConfig } from "./lib/bookingSlots";

const MAX_DISPLAY_NAME = 60;
const MAX_SHOP_NAME = 60;
const MAX_BIO = 240;
const MAX_CONTACT_EMAIL = 254;
// Mirrors convex/contact.ts's EMAIL_RE — kept local rather than shared since
// this file can't import from a route handler, and duplicating one regex is
// cheaper than a new shared module.
const CONTACT_EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

// Hairstyle-slug validation for the per-cut tryOn counter.
const CUT_SLUG_RE = /^[a-z0-9-]{1,60}$/;

// Cap on the number of distinct cut slugs tracked per daily bucket.
// Prevents unbounded key growth if many one-off slugs are sent.
const BY_STYLE_KEY_CAP = 60;

/** The shape a public visitor is allowed to see. Never leaks ownerUserId. */
type PublicBarberPage = {
  slug: string;
  displayName: string;
  shopName?: string;
  bio?: string;
  links: { kind: string; label: string; url: string }[];
  styles: string[];
  /** The owner's referral code — the point of the whole page. */
  referralCode?: string;
  /** Resolved avatar URL — undefined when none set or file not found. */
  avatarUrl?: string;
  bannerUrl?: string;
  location?: string;
  hours?: string;
  services?: { name: string; price?: string }[];
  /** Present only when the barber turned native scheduling on. */
  booking?: {
    timezone: string;
    slotMinutes: number;
    days: { day: number; start: string; end: string }[];
  };
};

async function requireUser(ctx: MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in to build your card.");
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError("User not found.");
  return user;
}

async function pageBySlug(ctx: QueryCtx, slug: string): Promise<Doc<"barberPages"> | null> {
  return await ctx.db
    .query("barberPages")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
}

function dayBucket(now: number): string {
  return new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD
}

// ── public ──────────────────────────────────────────────────

/**
 * The card, for anyone with the link. Returns null for an unknown or
 * unpublished slug — an unpublished card is invisible, not 403, so a draft
 * slug can't be probed.
 */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args): Promise<PublicBarberPage | null> => {
    const normalized = normalizeSlug(args.slug);
    if (!normalized.ok) return null;

    const page = await pageBySlug(ctx, normalized.slug);
    if (!page || !page.published) return null;

    // The referral code is what makes a try-on attributable to this barber.
    const owner = await ctx.db.get(page.ownerUserId);

    const avatarUrl = page.avatarStorageId
      ? (await ctx.storage.getUrl(page.avatarStorageId)) ?? undefined
      : undefined;
    const bannerUrl = page.bannerStorageId
      ? (await ctx.storage.getUrl(page.bannerStorageId)) ?? undefined
      : undefined;

    return {
      slug: page.slug,
      displayName: page.displayName,
      shopName: page.shopName,
      bio: page.bio,
      links: page.links,
      styles: page.styles,
      referralCode: owner?.referralCode,
      avatarUrl,
      bannerUrl,
      location: page.location,
      hours: page.hours,
      services: page.services,
      booking: page.booking?.enabled
        ? {
            timezone: page.booking.timezone,
            slotMinutes: page.booking.slotMinutes,
            days: page.booking.days,
          }
        : undefined,
    };
  },
});

/** Is this slug free? Used by the builder as the barber types. */
export const checkSlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args): Promise<{ available: boolean; error?: string }> => {
    const normalized = normalizeSlug(args.slug);
    if (!normalized.ok) return { available: false, error: normalized.error };

    const existing = await pageBySlug(ctx, normalized.slug);
    if (!existing) return { available: true };

    // Their own slug reads as available — re-saving your card isn't a clash.
    const identity = await ctx.auth.getUserIdentity();
    if (identity) {
      const owner = await ctx.db.get(existing.ownerUserId);
      if (owner?.tokenIdentifier === identity.tokenIdentifier) return { available: true };
    }
    return { available: false, error: "That name is taken." };
  },
});

/**
 * Count a scan, a try-on tap, or a link tap. Public and unauthenticated — the
 * visitors we most want to count are strangers who have never signed in.
 *
 * Rate-limited per slug+kind: the counters are the barber's evidence that the
 * QR is working, so inflating them is the obvious abuse. Failures are swallowed
 * by the caller — a dropped count must never break the page.
 */
export const recordEvent = mutation({
  args: {
    slug: v.string(),
    kind: v.union(
      v.literal("view"),
      v.literal("tryOn"),
      v.literal("linkClick"),
      v.literal("bookingClick"),
      v.literal("selfieStart"),
      v.literal("preview"),
    ),
    cutSlug: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    const normalized = normalizeSlug(args.slug);
    if (!normalized.ok) return null;

    const page = await pageBySlug(ctx, normalized.slug);
    if (!page || !page.published) return null;

    // Generous: a real barbershop can genuinely produce a burst of scans.
    await enforceMutationRateLimit(
      ctx,
      `barberEvent:${normalized.slug}:${args.kind}`,
      120,
      60_000,
    );

    const bucket = dayBucket(Date.now());
    const existing = await ctx.db
      .query("barberPageStats")
      .withIndex("by_page_and_bucket", (q) => q.eq("pageId", page._id).eq("bucket", bucket))
      .unique();

    // Validate cutSlug — silently ignore if invalid (still count the tryOn).
    const validCutSlug =
      args.kind === "tryOn" &&
      args.cutSlug !== undefined &&
      CUT_SLUG_RE.test(args.cutSlug)
        ? args.cutSlug
        : undefined;

    // Build byStyle update: only for tryOn with a valid cutSlug.
    // Cap: if the bucket already has BY_STYLE_KEY_CAP distinct slugs and this
    // one is new, don't add it (abuse bound) — but still count the tryOn.
    let byStyleUpdate: Record<string, number> | undefined;
    if (validCutSlug !== undefined) {
      const currentByStyle = existing?.byStyle ?? {};
      const hasKey = validCutSlug in currentByStyle;
      const atCap = Object.keys(currentByStyle).length >= BY_STYLE_KEY_CAP;
      if (!atCap || hasKey) {
        byStyleUpdate = {
          ...currentByStyle,
          [validCutSlug]: (currentByStyle[validCutSlug] ?? 0) + 1,
        };
      }
    }

    const k = args.kind;

    if (!existing) {
      await ctx.db.insert("barberPageStats", {
        pageId: page._id,
        bucket,
        views: k === "view" ? 1 : 0,
        tryOns: k === "tryOn" ? 1 : 0,
        linkClicks: k === "linkClick" ? 1 : 0,
        bookingClicks: k === "bookingClick" ? 1 : undefined,
        selfieStarts: k === "selfieStart" ? 1 : undefined,
        previews: k === "preview" ? 1 : undefined,
        byStyle: byStyleUpdate,
      });
      return null;
    }

    // Build patch incrementally to avoid touching optional counters that didn't
    // change (keeps the document small for old buckets that lack new fields).
    const patch: {
      views: number;
      tryOns: number;
      linkClicks: number;
      bookingClicks?: number;
      selfieStarts?: number;
      previews?: number;
      byStyle?: Record<string, number>;
    } = {
      views: existing.views + (k === "view" ? 1 : 0),
      tryOns: existing.tryOns + (k === "tryOn" ? 1 : 0),
      linkClicks: existing.linkClicks + (k === "linkClick" ? 1 : 0),
    };
    if (k === "bookingClick") patch.bookingClicks = (existing.bookingClicks ?? 0) + 1;
    if (k === "selfieStart") patch.selfieStarts = (existing.selfieStarts ?? 0) + 1;
    if (k === "preview") patch.previews = (existing.previews ?? 0) + 1;
    if (byStyleUpdate !== undefined) patch.byStyle = byStyleUpdate;

    await ctx.db.patch(existing._id, patch);
    return null;
  },
});

// ── owner ───────────────────────────────────────────────────

/** The caller's own card, plus its stats. Null when they haven't made one. */
export const getMine = query({
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

    // Bounded: the last ~90 daily buckets is plenty to total and to trend.
    const stats = await ctx.db
      .query("barberPageStats")
      .withIndex("by_page_and_bucket", (q) => q.eq("pageId", page._id))
      .order("desc")
      .take(90);

    // Legacy totals (kept for backwards-compat with existing clients/tests).
    const totals = stats.reduce(
      (acc, row) => ({
        views: acc.views + row.views,
        tryOns: acc.tryOns + row.tryOns,
        linkClicks: acc.linkClicks + row.linkClicks,
      }),
      { views: 0, tryOns: 0, linkClicks: 0 },
    );

    const avatarUrl = page.avatarStorageId
      ? (await ctx.storage.getUrl(page.avatarStorageId)) ?? undefined
      : undefined;
    const bannerUrl = page.bannerStorageId
      ? (await ctx.storage.getUrl(page.bannerStorageId)) ?? undefined
      : undefined;

    const insights = computeInsights(stats, Date.now());

    return {
      slug: page.slug,
      displayName: page.displayName,
      shopName: page.shopName,
      bio: page.bio,
      links: page.links,
      styles: page.styles,
      published: page.published,
      // Owner-only — never returned by the public getBySlug query.
      contactEmail: page.contactEmail,
      referralCode: user.referralCode,
      totals,
      // Redesign fields:
      avatarStorageId: page.avatarStorageId,
      avatarUrl,
      bannerStorageId: page.bannerStorageId,
      bannerUrl,
      location: page.location,
      hours: page.hours,
      services: page.services,
      booking: page.booking,
      insights,
    };
  },
});

/**
 * Create or update the caller's card. One card per barber: the owner index is
 * the identity, so re-saving edits in place and a second call can never mint a
 * second card or steal someone else's slug.
 */
export const upsert = mutation({
  args: {
    slug: v.string(),
    displayName: v.string(),
    shopName: v.optional(v.string()),
    bio: v.optional(v.string()),
    // Raw, as typed into the form ("@marcus", "(415) 555-0134"). The server
    // normalizes — never trust a pre-built URL from the client.
    links: v.array(
      v.object({
        kind: v.string(),
        value: v.string(),
        label: v.optional(v.string()),
      }),
    ),
    styles: v.array(v.string()),
    published: v.boolean(),
    // The barber's own inbox, for "a client picked a cut" notifications —
    // never shown on the public card. Optional: cards work without it, they
    // just can't be emailed a result.
    contactEmail: v.optional(v.string()),
    // Redesign fields — all optional:
    // The client uploads via barberTryOn.generateUploadUrl then passes the ID.
    avatarStorageId: v.optional(v.id("_storage")),
    clearAvatar: v.optional(v.boolean()),
    bannerStorageId: v.optional(v.id("_storage")),
    clearBanner: v.optional(v.boolean()),
    location: v.optional(v.string()),
    hours: v.optional(v.string()),
    services: v.optional(
      v.array(v.object({ name: v.string(), price: v.optional(v.string()) })),
    ),
    // Native scheduling config — validated hard by normalizeBookingConfig.
    booking: v.optional(
      v.object({
        enabled: v.boolean(),
        timezone: v.string(),
        slotMinutes: v.number(),
        days: v.array(v.object({ day: v.number(), start: v.string(), end: v.string() })),
      }),
    ),
  },
  handler: async (ctx, args): Promise<{ slug: string }> => {
    const user = await requireUser(ctx);
    await enforceMutationRateLimit(ctx, `barberUpsert:${user._id}`, 20, 60_000);

    const slugCheck = normalizeSlug(args.slug);
    if (!slugCheck.ok) throw new ConvexError(slugCheck.error);
    const slug = slugCheck.slug;

    const displayName = args.displayName.trim();
    if (!displayName) throw new ConvexError("Add your name so clients know whose card this is.");

    const existing = await ctx.db
      .query("barberPages")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", user._id))
      .first();

    // Slug collisions: taken by someone else is an error; taken by you is a no-op.
    const slugHolder = await pageBySlug(ctx, slug);
    if (slugHolder && slugHolder._id !== existing?._id) {
      throw new ConvexError("That name is taken.");
    }

    if (args.links.length > MAX_LINKS) {
      throw new ConvexError(`At most ${MAX_LINKS} links.`);
    }
    const links = args.links.map((link) => {
      const result = normalizeBarberLink(link.kind, link.value, link.label);
      if (!result.ok) throw new ConvexError(result.error);
      return result.link;
    });

    // Style slugs are echoed into `/hair-previews/<slug>.png` and `?cut=`, so
    // they're deduped and capped. They're not validated against the catalog
    // here — convex/ can't import from src/ — but the card only renders art for
    // slugs it recognizes, and `?cut=` is re-checked on the way back in.
    const styles = [...new Set(args.styles)].slice(0, MAX_STYLES);

    const contactEmail = args.contactEmail?.trim().toLowerCase().slice(0, MAX_CONTACT_EMAIL) || undefined;
    if (contactEmail && !CONTACT_EMAIL_RE.test(contactEmail)) {
      throw new ConvexError("That doesn't look like a valid email address.");
    }

    // Scheduling config: absent leaves the stored value alone (older builder
    // clients don't send it); present is fully re-validated.
    let booking: BookingConfig | undefined;
    if (args.booking !== undefined) {
      const bookingCheck = normalizeBookingConfig(args.booking);
      if (!bookingCheck.ok) throw new ConvexError(bookingCheck.error);
      booking = bookingCheck.config;
    }

    // Redesign field normalization — server-authoritative.
    const location = args.location?.trim().slice(0, 80) || undefined;
    const hours = args.hours?.trim().slice(0, 120) || undefined;
    const services = args.services
      ? args.services
          .map((s) => {
            const price = s.price?.trim().slice(0, 20) || undefined;
            return price !== undefined
              ? { name: s.name.trim().slice(0, 60), price }
              : { name: s.name.trim().slice(0, 60) };
          })
          .filter((s) => s.name.length > 0)
          .slice(0, 12)
      : undefined;

    // Avatar semantics:
    //   clearAvatar=true  → explicitly unset the stored ID
    //   avatarStorageId   → set to the new ID
    //   neither           → leave the existing value unchanged
    const shouldWriteAvatar = args.clearAvatar === true || args.avatarStorageId !== undefined;
    const avatarPatch: { avatarStorageId?: Id<"_storage"> } =
      args.clearAvatar === true
        ? { avatarStorageId: undefined }
        : args.avatarStorageId !== undefined
        ? { avatarStorageId: args.avatarStorageId }
        : {};
    const shouldWriteBanner = args.clearBanner === true || args.bannerStorageId !== undefined;
    const bannerPatch: { bannerStorageId?: Id<"_storage"> } =
      args.clearBanner === true
        ? { bannerStorageId: undefined }
        : args.bannerStorageId !== undefined
          ? { bannerStorageId: args.bannerStorageId }
          : {};

    const now = Date.now();
    const fields = {
      slug,
      displayName: displayName.slice(0, MAX_DISPLAY_NAME),
      shopName: args.shopName?.trim().slice(0, MAX_SHOP_NAME) || undefined,
      bio: args.bio?.trim().slice(0, MAX_BIO) || undefined,
      links,
      styles,
      published: args.published,
      contactEmail,
      location,
      hours,
      services,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...fields,
        ...(booking !== undefined ? { booking } : {}),
        ...(shouldWriteAvatar ? avatarPatch : {}),
        ...(shouldWriteBanner ? bannerPatch : {}),
      });
    } else {
      await ctx.db.insert("barberPages", {
        ...fields,
        ...(booking !== undefined ? { booking } : {}),
        ...avatarPatch,
        ...bannerPatch,
        ownerUserId: user._id,
        createdAt: now,
      });
    }

    // The card is worthless without a code to attribute clients with — every
    // outbound link on it carries one. Backfill for accounts that predate them.
    if (!user.referralCode) {
      await ctx.db.patch(user._id, { referralCode: await uniqueReferralCode(ctx) });
    }

    return { slug };
  },
});

/** Take the card offline without deleting it (the slug stays reserved). */
export const setPublished = mutation({
  args: { published: v.boolean() },
  handler: async (ctx, args): Promise<null> => {
    const user = await requireUser(ctx);
    const page = await ctx.db
      .query("barberPages")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", user._id))
      .first();
    if (!page) throw new ConvexError("You don't have a card yet.");

    await ctx.db.patch(page._id, { published: args.published, updatedAt: Date.now() });
    return null;
  },
});

export type { PublicBarberPage };
export type BarberPageId = Id<"barberPages">;
