import { v } from "convex/values";

export const BARBER_BATCH_MONTHLY_CAP = 1;
export const BARBER_BATCH_IP_CAP = 5;
export const BARBER_BATCH_IP_WINDOW_MS = 24 * 60 * 60 * 1000;
export const BARBER_BATCH_STALE_MS = 5 * 60 * 1000;
export const BARBER_BATCH_ITEM_COUNT = 8;

export const barberBatchStatusValidator = v.union(
  v.literal("analyzing"),
  v.literal("generating"),
  v.literal("ready"),
  v.literal("rejected"),
  v.literal("failed"),
);

export const barberBatchItemStatusValidator = v.union(
  v.literal("pending"),
  v.literal("editing"),
  v.literal("rendering"),
  v.literal("done"),
  v.literal("failed"),
);

export const hairProfileValidator = v.object({
  curlClass: v.string(),
  lengthInches: v.object({
    top: v.number(),
    sides: v.number(),
    back: v.number(),
  }),
  density: v.union(v.literal("low"), v.literal("med"), v.literal("high")),
  hairline: v.object({
    state: v.union(v.literal("intact"), v.literal("mature"), v.literal("receding")),
    notes: v.optional(v.string()),
  }),
  growthPatterns: v.array(v.string()),
  faceShape: v.string(),
  barberNotes: v.optional(v.string()),
});

export const barberBatchItemSeedValidator = v.object({
  idx: v.number(),
  title: v.string(),
  prompt: v.string(),
  why: v.optional(v.string()),
});
