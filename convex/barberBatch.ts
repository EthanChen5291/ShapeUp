import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { isDisposableEmailDomain } from "./lib/disposableEmail";
import { normalizeSlug } from "./lib/barberLinks";
import {
  BARBER_BATCH_IP_CAP,
  BARBER_BATCH_IP_WINDOW_MS,
  BARBER_BATCH_ITEM_COUNT,
  BARBER_BATCH_MONTHLY_CAP,
  BARBER_BATCH_STALE_MS,
  barberBatchItemSeedValidator,
  barberBatchItemStatusValidator,
  hairProfileValidator,
} from "./lib/barberBatch";

type AuthenticatedCtx = MutationCtx | QueryCtx;
type BatchSignalType = Extract<
  Doc<"freeGenGrants">["signalType"],
  "barberBatchUser" | "barberBatchFingerprint" | "barberBatchIp"
>;

const FACELIFT_KEY_RE = /^facelifts\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

async function requireUser(ctx: AuthenticatedCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated");

  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) {
    throw new ConvexError({
      code: "account_missing",
      message: "Couldn't find your account. Please reload and try again.",
    });
  }
  return user;
}

async function requireOwnedBatch(
  ctx: AuthenticatedCtx,
  batchId: Id<"barberBatches">,
  userId: Id<"users">,
): Promise<Doc<"barberBatches">> {
  const batch = await ctx.db.get("barberBatches", batchId);
  if (!batch || batch.userId !== userId) {
    throw new ConvexError({ code: "batch_not_found", message: "Batch not found." });
  }
  return batch;
}

function currentMonthStart(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

async function recentSignalGrants(
  ctx: MutationCtx,
  signalType: BatchSignalType,
  signalHash: string,
  limit: number,
) {
  return await ctx.db
    .query("freeGenGrants")
    .withIndex("by_signal", (q) =>
      q.eq("signalType", signalType).eq("signalHash", signalHash),
    )
    .order("desc")
    .take(limit);
}

/**
 * Consume the monthly barber-batch entitlement in one serializable
 * transaction. This cap is always enforced; payment-mode flags do not apply to
 * this abuse boundary.
 */
export const consumeBatch = mutation({
  args: {
    ipHash: v.string(),
    fingerprintHash: v.optional(v.string()),
  },
  handler: async (ctx, { ipHash, fingerprintHash }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) {
      throw new ConvexError({
        code: "account_missing",
        message: "Couldn't find your account. Please reload and try again.",
      });
    }

    const emailVerified = identity.emailVerified as boolean | string | undefined;
    if (emailVerified === false || emailVerified === "false") {
      throw new ConvexError({
        code: "email_unverified",
        message: "Please verify your email to create your free hairstyle batch.",
      });
    }
    const email = (user.email || identity.email || "").toLowerCase().trim();
    if (!email || isDisposableEmailDomain(email)) {
      throw new ConvexError({
        code: "email_required",
        message: "A permanent email address is required for the free hairstyle batch.",
      });
    }

    const now = Date.now();
    const monthStart = currentMonthStart(now);
    const userSignalHash = String(user._id);
    const userGrants = await recentSignalGrants(
      ctx,
      "barberBatchUser",
      userSignalHash,
      BARBER_BATCH_MONTHLY_CAP + 1,
    );
    if (userGrants.filter((grant) => grant.grantedAt >= monthStart).length >= BARBER_BATCH_MONTHLY_CAP) {
      throw new ConvexError({
        code: "batch_used",
        message: "You've already used your free hairstyle batch for this month.",
      });
    }

    if (fingerprintHash) {
      const fingerprintGrants = await recentSignalGrants(
        ctx,
        "barberBatchFingerprint",
        fingerprintHash,
        BARBER_BATCH_MONTHLY_CAP + 1,
      );
      if (
        fingerprintGrants.filter((grant) => grant.grantedAt >= monthStart).length >=
        BARBER_BATCH_MONTHLY_CAP
      ) {
        throw new ConvexError({
          code: "batch_device_used",
          message: "This device has already used its free hairstyle batch for this month.",
        });
      }
    }

    const ipGrants = await recentSignalGrants(
      ctx,
      "barberBatchIp",
      ipHash,
      BARBER_BATCH_IP_CAP + 1,
    );
    const ipWindowStart = now - BARBER_BATCH_IP_WINDOW_MS;
    if (ipGrants.filter((grant) => grant.grantedAt >= ipWindowStart).length >= BARBER_BATCH_IP_CAP) {
      throw new ConvexError({
        code: "network_limited",
        message: "Too many free hairstyle batches from this network. Try again tomorrow.",
      });
    }

    await ctx.db.insert("freeGenGrants", {
      signalType: "barberBatchUser",
      signalHash: userSignalHash,
      userId: user._id,
      grantedAt: now,
    });
    await ctx.db.insert("freeGenGrants", {
      signalType: "barberBatchIp",
      signalHash: ipHash,
      userId: user._id,
      grantedAt: now,
    });
    if (fingerprintHash) {
      await ctx.db.insert("freeGenGrants", {
        signalType: "barberBatchFingerprint",
        signalHash: fingerprintHash,
        userId: user._id,
        grantedAt: now,
      });
    }

    return { path: "free" as const, batchesRemaining: 0 };
  },
});

/** Create the durable parent before the analysis result is recorded. */
export const create = mutation({
  args: {
    slug: v.string(),
    selfieStorageId: v.id("_storage"),
  },
  handler: async (ctx, args): Promise<Id<"barberBatches">> => {
    const user = await requireUser(ctx);
    const normalized = normalizeSlug(args.slug);
    if (!normalized.ok) throw new ConvexError(normalized.error);

    const page = await ctx.db
      .query("barberPages")
      .withIndex("by_slug", (q) => q.eq("slug", normalized.slug))
      .unique();
    if (!page || !page.published) {
      throw new ConvexError({ code: "page_not_found", message: "Barber page not found." });
    }
    const selfie = await ctx.db.system.get("_storage", args.selfieStorageId);
    if (!selfie) {
      throw new ConvexError({ code: "selfie_not_found", message: "Selfie not found." });
    }

    return await ctx.db.insert("barberBatches", {
      userId: user._id,
      pageId: page._id,
      selfieStorageId: args.selfieStorageId,
      status: "analyzing",
      createdAt: Date.now(),
    });
  },
});

const analysisResultValidator = v.union(
  v.object({
    ok: v.literal(false),
    rejectionReason: v.string(),
  }),
  v.object({
    ok: v.literal(true),
    hairProfile: hairProfileValidator,
    items: v.array(barberBatchItemSeedValidator),
  }),
);

/** Persist a rejected analysis or atomically seed all eight accepted styles. */
export const setAnalysis = mutation({
  args: {
    batchId: v.id("barberBatches"),
    result: analysisResultValidator,
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const batch = await requireOwnedBatch(ctx, args.batchId, user._id);
    if (batch.status !== "analyzing") {
      throw new ConvexError({ code: "invalid_batch_state", message: "Batch analysis is already set." });
    }

    if (!args.result.ok) {
      const rejectionReason = args.result.rejectionReason.trim().slice(0, 240);
      if (!rejectionReason) {
        throw new ConvexError({ code: "invalid_analysis", message: "A rejection reason is required." });
      }
      await ctx.db.patch(batch._id, { status: "rejected", rejectionReason });
      return { status: "rejected" as const, items: [] };
    }

    if (args.result.items.length !== BARBER_BATCH_ITEM_COUNT) {
      throw new ConvexError({
        code: "invalid_analysis",
        message: `Analysis must contain exactly ${BARBER_BATCH_ITEM_COUNT} styles.`,
      });
    }
    const sortedItems = [...args.result.items].sort((a, b) => a.idx - b.idx);
    const validIndices = sortedItems.every((item, idx) => item.idx === idx);
    if (!validIndices) {
      throw new ConvexError({
        code: "invalid_analysis",
        message: `Style indexes must cover 0 through ${BARBER_BATCH_ITEM_COUNT - 1}.`,
      });
    }

    const itemIds: { idx: number; itemId: Id<"barberBatchItems"> }[] = [];
    for (const item of sortedItems) {
      const title = item.title.trim().split(/\s+/).slice(0, 4).join(" ").slice(0, 80);
      const prompt = item.prompt.trim().slice(0, 4_000);
      const why = item.why?.trim().slice(0, 240) || undefined;
      if (!title || !prompt) {
        throw new ConvexError({
          code: "invalid_analysis",
          message: "Every style needs a title and prompt.",
        });
      }
      const itemId = await ctx.db.insert("barberBatchItems", {
        batchId: batch._id,
        idx: item.idx,
        title,
        prompt,
        why,
        status: "pending",
        updatedAt: Date.now(),
      });
      itemIds.push({ idx: item.idx, itemId });
    }

    await ctx.db.patch(batch._id, {
      status: "generating",
      rejectionReason: undefined,
      hairProfile: args.result.hairProfile,
    });
    return { status: "generating" as const, items: itemIds };
  },
});

/** Patch one independently progressing style while enforcing batch ownership. */
export const patchItem = mutation({
  args: {
    itemId: v.id("barberBatchItems"),
    status: barberBatchItemStatusValidator,
    imageStorageId: v.optional(v.id("_storage")),
    splatS3Key: v.optional(v.string()),
    videoS3Key: v.optional(v.string()),
    error: v.optional(v.string()),
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    const user = await requireUser(ctx);
    const item = await ctx.db.get("barberBatchItems", args.itemId);
    if (!item) {
      throw new ConvexError({ code: "item_not_found", message: "Batch item not found." });
    }
    const batch = await requireOwnedBatch(ctx, item.batchId, user._id);
    if (batch.status === "rejected") {
      throw new ConvexError({ code: "invalid_batch_state", message: "Rejected batches cannot be changed." });
    }
    if (args.splatS3Key && !FACELIFT_KEY_RE.test(args.splatS3Key)) {
      throw new ConvexError({ code: "invalid_asset_key", message: "Invalid rendered asset key." });
    }
    if (args.videoS3Key && !FACELIFT_KEY_RE.test(args.videoS3Key)) {
      throw new ConvexError({ code: "invalid_asset_key", message: "Invalid video asset key." });
    }
    if (args.imageStorageId) {
      const image = await ctx.db.system.get("_storage", args.imageStorageId);
      if (!image) {
        throw new ConvexError({ code: "image_not_found", message: "Edited image not found." });
      }
    }

    const patch: {
      status: Doc<"barberBatchItems">["status"];
      imageStorageId?: Id<"_storage">;
      splatS3Key?: string;
      videoS3Key?: string;
      error?: string;
      prompt?: string;
      updatedAt: number;
    } = { status: args.status, updatedAt: Date.now() };
    if (args.status === "editing") {
      patch.imageStorageId = undefined;
      patch.splatS3Key = undefined;
      patch.videoS3Key = undefined;
    }
    if (args.imageStorageId !== undefined) patch.imageStorageId = args.imageStorageId;
    if (args.splatS3Key !== undefined) patch.splatS3Key = args.splatS3Key;
    if (args.videoS3Key !== undefined) patch.videoS3Key = args.videoS3Key;
    if (args.error !== undefined) patch.error = args.error.trim().slice(0, 300) || undefined;
    if (args.prompt !== undefined) {
      const prompt = args.prompt.trim().slice(0, 500);
      if (!prompt) {
        throw new ConvexError({ code: "invalid_prompt", message: "The edit prompt cannot be empty." });
      }
      patch.prompt = prompt;
    }
    if (args.status !== "failed") patch.error = undefined;

    await ctx.db.patch(item._id, patch);
    if (
      (batch.status === "ready" || batch.status === "failed") &&
      args.status !== "done" &&
      args.status !== "failed"
    ) {
      await ctx.db.patch(batch._id, { status: "generating" });
    }
    return null;
  },
});

/** Set the terminal parent status after all eight item jobs have settled. */
export const finish = mutation({
  args: { batchId: v.id("barberBatches") },
  handler: async (ctx, args): Promise<{ status: "ready" | "failed" }> => {
    const user = await requireUser(ctx);
    const batch = await requireOwnedBatch(ctx, args.batchId, user._id);
    const items = await ctx.db
      .query("barberBatchItems")
      .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
      .take(BARBER_BATCH_ITEM_COUNT + 1);
    if (items.length !== BARBER_BATCH_ITEM_COUNT) {
      throw new ConvexError({
        code: "batch_incomplete",
        message: `Batch must contain exactly ${BARBER_BATCH_ITEM_COUNT} styles.`,
      });
    }
    if (items.some((item) => item.status !== "done" && item.status !== "failed")) {
      throw new ConvexError({ code: "batch_incomplete", message: "Batch items are still in progress." });
    }

    const status = items.some((item) => item.status === "done") ? "ready" : "failed";
    await ctx.db.patch(batch._id, { status });
    return { status };
  },
});

/** Resume the caller's newest usable batch for this barber page. */
export const latestForPage = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;

    const normalized = normalizeSlug(args.slug);
    if (!normalized.ok) return null;
    const page = await ctx.db
      .query("barberPages")
      .withIndex("by_slug", (q) => q.eq("slug", normalized.slug))
      .unique();
    if (!page || !page.published) return null;

    // One entitlement per month keeps this bounded window at roughly two years
    // of history while allowing failed attempts to be skipped.
    const candidates = await ctx.db
      .query("barberBatches")
      .withIndex("by_user_and_created_at", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(24);
    const batch = candidates.find(
      (candidate) => candidate.pageId === page._id && candidate.status !== "failed",
    );
    if (!batch) return null;

    const rows = await ctx.db
      .query("barberBatchItems")
      .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
      .take(BARBER_BATCH_ITEM_COUNT + 1);
    const now = Date.now();
    const items = await Promise.all(
      rows
        .sort((a, b) => a.idx - b.idx)
        .map(async (item) => {
          const terminal = item.status === "done" || item.status === "failed";
          const stale =
            !terminal && now - (item.updatedAt ?? item._creationTime) > BARBER_BATCH_STALE_MS;
          const imageUrl = item.imageStorageId
            ? (await ctx.storage.getUrl(item.imageStorageId)) ?? undefined
            : undefined;
          return {
            ...item,
            status: stale ? ("failed" as const) : item.status,
            stale,
            imageUrl,
          };
        }),
    );
    const selfieUrl = (await ctx.storage.getUrl(batch.selfieStorageId)) ?? undefined;

    return {
      ...batch,
      selfieUrl,
      items,
    };
  },
});

/** Resolve one caller-owned item and its original selfie for a safe retry. */
export const getItemForRetry = query({
  args: { itemId: v.id("barberBatchItems") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const item = await ctx.db.get("barberBatchItems", args.itemId);
    if (!item) {
      throw new ConvexError({ code: "item_not_found", message: "Batch item not found." });
    }
    const batch = await requireOwnedBatch(ctx, item.batchId, user._id);
    const selfieUrl = await ctx.storage.getUrl(batch.selfieStorageId);
    if (!selfieUrl) {
      throw new ConvexError({ code: "selfie_not_found", message: "The original selfie is unavailable." });
    }
    const terminal = item.status === "done" || item.status === "failed";
    const stale =
      !terminal && Date.now() - (item.updatedAt ?? item._creationTime) > BARBER_BATCH_STALE_MS;
    return {
      itemId: item._id,
      batchId: batch._id,
      status: stale ? ("failed" as const) : item.status,
      stale,
      idx: item.idx,
      title: item.title,
      prompt: item.prompt,
      selfieUrl,
    };
  },
});
