// ============================================================
// The embedded try-on's plumbing: selfie upload, and delivering the finished
// cut to the barber who sent the client here.
//
// Generation itself (POST /api/gemini-hair-edit) is called directly by the
// client — this file only owns the two things Convex is actually needed for:
// a place to put the uploaded selfie, and sending the result on to the barber
// once the client picks a cut to send.
//
// Delivery model: the barberSends row is the send — it shows up as the
// "Client requests" inbox in the barber's builder no matter what. The
// notification email is best-effort on top: a barber with no contact email,
// or a deployment with no RESEND_API_KEY, still receives every send.
//
// Trust model: every function here requires a signed-in visitor (the embedded
// flow's first step is an inline sign-in — see src/components/BarberTryOn.tsx)
// — there is no anonymous path anywhere in the real generation pipeline
// (/api/gemini-hair-edit, /api/facelift), so this doesn't weaken that.
// ============================================================

import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { normalizeSlug } from "./lib/barberLinks";
import { buildBarberEmail } from "./lib/barberEmail";
import { enforceMutationRateLimit } from "./lib/rateLimit";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

/** Where the client's selfie gets uploaded before it's sent to gemini-hair-edit. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return ctx.storage.generateUploadUrl();
  },
});

/** Resolve an uploaded selfie's storage id to a fetchable URL. */
export const getUploadedImageUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return await ctx.storage.getUrl(args.storageId);
  },
});

/** Internal-only: the barber's private inbox, never exposed to a public query. */
export const getBarberContactBySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const normalized = normalizeSlug(args.slug);
    if (!normalized.ok) return null;
    const page = await ctx.db
      .query("barberPages")
      .withIndex("by_slug", (q) => q.eq("slug", normalized.slug))
      .unique();
    if (!page || !page.published) return null;
    return { pageId: page._id, contactEmail: page.contactEmail, displayName: page.displayName };
  },
});

/** The durable half of a send — the row the barber's inbox reads. */
export const recordSend = internalMutation({
  args: {
    pageId: v.id("barberPages"),
    cutLabel: v.string(),
    imageUrl: v.string(),
    videoUrl: v.optional(v.string()),
    clientRequest: v.optional(v.string()),
    styleTitle: v.optional(v.string()),
    stylePrompt: v.optional(v.string()),
    hairProfile: v.optional(v.string()),
    clientEmail: v.optional(v.string()),
    clientPhone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"barberSends">> => {
    return await ctx.db.insert("barberSends", {
      ...args,
      emailed: false,
      createdAt: Date.now(),
    });
  },
});

export const markSendEmailed = internalMutation({
  args: { sendId: v.id("barberSends") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sendId, { emailed: true });
  },
});

export const updateSendVideo = internalMutation({
  args: { sendId: v.id("barberSends"), videoUrl: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sendId, { videoUrl: args.videoUrl });
  },
});

/**
 * The barber's chair-side inbox: what clients sent through their card, newest
 * first. Owner-only — these rows carry client contact info.
 */
export const listMySends = query({
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

    const sends = await ctx.db
      .query("barberSends")
      .withIndex("by_page", (q) => q.eq("pageId", page._id))
      .order("desc")
      .take(30);
    return sends.map((s) => ({
      id: s._id,
      cutLabel: s.cutLabel,
      imageUrl: s.imageUrl,
      videoUrl: s.videoUrl,
      clientRequest: s.clientRequest,
      styleTitle: s.styleTitle,
      stylePrompt: s.stylePrompt,
      hairProfile: s.hairProfile,
      clientEmail: s.clientEmail,
      clientPhone: s.clientPhone,
      createdAt: s.createdAt,
    }));
  },
});

/** Actions can't touch ctx.db directly — the rate-limit bucket lives here. */
export const checkSendRateLimit = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    await enforceMutationRateLimit(ctx, args.key, 10, 60_000);
  },
});

export type SendToBarberResult =
  | { ok: true; emailed: boolean }
  | { ok: false; reason: "unknown_page" };

/**
 * Copy a short-lived render URL into Convex storage without routing the media
 * through the client's browser. Failure is non-fatal: the original URL is
 * still better than dropping the entire barber send.
 */
async function mirrorRemoteMedia(
  ctx: ActionCtx,
  url: string | undefined,
): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`media fetch returned ${response.status}`);
    const storageId = await ctx.storage.store(await response.blob());
    return (await ctx.storage.getUrl(storageId)) ?? url;
  } catch (err) {
    console.warn("[barberTryOn] Could not mirror 360 video; keeping source URL", err);
    return url;
  }
}

/**
 * Deliver the cut a client just previewed on themselves to the barber: a
 * durable barberSends row first (the barber's inbox in the builder), then a
 * best-effort notification email on top. Only an unknown/unpublished slug is
 * a failure — a missing contact email or unconfigured Resend downgrades to
 * `emailed: false`, never a lost send.
 */
export const sendToBarber = action({
  args: {
    slug: v.string(),
    cutLabel: v.string(),
    imageUrl: v.string(),
    videoUrl: v.optional(v.string()),
    clientRequest: v.optional(v.string()),
    styleTitle: v.optional(v.string()),
    stylePrompt: v.optional(v.string()),
    hairProfile: v.optional(v.string()),
    clientEmail: v.optional(v.string()),
    clientPhone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SendToBarberResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    await ctx.runMutation(internal.barberTryOn.checkSendRateLimit, {
      key: `sendToBarber:${identity.tokenIdentifier}`,
    });

    const barberContact = await ctx.runQuery(internal.barberTryOn.getBarberContactBySlug, {
      slug: args.slug,
    });
    if (!barberContact) {
      return { ok: false, reason: "unknown_page" };
    }

    const clientRequest = args.clientRequest?.trim().slice(0, 500) || undefined;
    const styleTitle = args.styleTitle?.trim().slice(0, 80) || undefined;
    const stylePrompt = args.stylePrompt?.trim().slice(0, 4_000) || undefined;
    const hairProfile = args.hairProfile?.trim().slice(0, 1_500) || undefined;
    // The inbox row comes first. From this point onward, media mirroring and
    // email are best-effort notifications and can never turn a delivered send
    // into a client-visible failure.
    const sendId: Id<"barberSends"> = await ctx.runMutation(internal.barberTryOn.recordSend, {
      pageId: barberContact.pageId,
      cutLabel: args.cutLabel,
      imageUrl: args.imageUrl,
      videoUrl: args.videoUrl,
      clientRequest,
      styleTitle,
      stylePrompt,
      hairProfile,
      clientEmail: args.clientEmail,
      clientPhone: args.clientPhone,
    });
    const durableVideoUrl = await mirrorRemoteMedia(ctx, args.videoUrl);
    if (durableVideoUrl && durableVideoUrl !== args.videoUrl) {
      await ctx.runMutation(internal.barberTryOn.updateSendVideo, { sendId, videoUrl: durableVideoUrl });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!barberContact.contactEmail || !apiKey) {
      if (!apiKey) {
        console.warn("[barberTryOn] No RESEND_API_KEY set — send saved to inbox, email skipped");
      }
      return { ok: true, emailed: false };
    }

    const { subject, html } = buildBarberEmail({
      displayName: barberContact.displayName,
      cutLabel: args.cutLabel,
      imageUrl: args.imageUrl,
      videoUrl: durableVideoUrl,
      clientRequest,
      styleTitle,
      stylePrompt,
      hairProfile,
      clientEmail: args.clientEmail,
      clientPhone: args.clientPhone,
    });

    const from = process.env.RESEND_FROM_EMAIL ?? "ShapeUp <notifications@tryshapeup.cc>";
    let res: Response;
    try {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: barberContact.contactEmail, subject, html }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      console.error("[barberTryOn] Resend request failed:", err);
      return { ok: true, emailed: false };
    }

    if (!res.ok) {
      console.error("[barberTryOn] Resend send failed:", res.status, await res.text().catch(() => ""));
      return { ok: true, emailed: false };
    }

    await ctx.runMutation(internal.barberTryOn.markSendEmailed, { sendId });
    return { ok: true, emailed: true };
  },
});
