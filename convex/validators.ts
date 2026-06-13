import { v } from "convex/values";

export const hairParamsValidator = v.object({
  topLength: v.number(),
  sideLength: v.number(),
  backLength: v.number(),
  messiness: v.number(),
  taper: v.number(),
  pc1: v.number(),
  pc2: v.number(),
  pc3: v.number(),
  pc4: v.number(),
  pc5: v.number(),
  pc6: v.number(),
});

const hairMeasurementsValidator = v.object({
  crownHeight: v.number(),
  sideWidth: v.number(),
  backLength: v.number(),
  flatness: v.number(),
  hairline: v.number(),
  hairThickness: v.number(),
});

const measurementSnapshotValidator = v.object({
  revision: v.number(),
  timestamp: v.string(),
  source: v.union(v.literal("scan"), v.literal("derived_params"), v.literal("mesh_bbox")),
  units: v.literal("scene_units"),
  baseline: hairMeasurementsValidator,
  estimated: hairMeasurementsValidator,
  currentParams: hairParamsValidator,
  bbox: v.optional(v.object({
    minX: v.number(),
    maxX: v.number(),
    minY: v.number(),
    maxY: v.number(),
    minZ: v.number(),
    maxZ: v.number(),
    width: v.number(),
    height: v.number(),
    depth: v.number(),
  })),
});

// imageDataUrl, maskDataUrl, and classifierFrames are intentionally excluded —
// they are base64 image captures that must never be persisted in Convex.
const faceScanDataValidator = v.object({
  landmarks: v.array(v.object({ x: v.number(), y: v.number(), z: v.number() })),
  imageWidth: v.number(),
  imageHeight: v.number(),
  arMesh: v.optional(v.object({
    vertices: v.array(v.array(v.number())),
    indices: v.array(v.array(v.number())),
    capturedAt: v.string(),
  })),
});

export const lastProfileValidator = v.object({
  headProportions: v.object({
    width: v.number(),
    height: v.number(),
    crownY: v.number(),
  }),
  anchors: v.object({
    earLeft: v.array(v.number()),
    earRight: v.array(v.number()),
  }),
  hairMeasurements: hairMeasurementsValidator,
  measurementSnapshot: v.optional(measurementSnapshotValidator),
  faceScanData: v.optional(faceScanDataValidator),
  currentStyle: v.object({
    preset: v.union(
      v.literal("buzz"),
      v.literal("pompadour"),
      v.literal("undercut"),
      v.literal("taper_fade"),
      v.literal("afro"),
      v.literal("waves"),
      v.literal("default"),
    ),
    hairType: v.union(v.literal("straight"), v.literal("wavy"), v.literal("curly")),
    colorRGB: v.string(),
    params: hairParamsValidator,
  }),
});
