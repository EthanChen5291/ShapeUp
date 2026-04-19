import {
  HairMeasurementBBox,
  HairMeasurementSnapshot,
  HairMeasurements,
  HairParams,
  UserHeadProfile,
} from '@/types';

type RawHairBBox = Omit<HairMeasurementBBox, 'width' | 'height' | 'depth'>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function normalizeBBox(bbox: RawHairBBox): HairMeasurementBBox {
  return {
    ...bbox,
    width: round(bbox.maxX - bbox.minX),
    height: round(bbox.maxY - bbox.minY),
    depth: round(bbox.maxZ - bbox.minZ),
  };
}

function estimateFromParams(baseline: HairMeasurements, params: HairParams): HairMeasurements {
  const crownHeight = round(baseline.crownHeight * params.topLength);
  const sideWidth = round(baseline.sideWidth * params.sideLength);
  const backLength = round(baseline.backLength * params.backLength);
  const flatness = round(clamp(baseline.flatness + params.messiness * 0.25 - params.taper * 0.1, 0, 1));
  const hairline = round(
    clamp(
      baseline.hairline * (0.88 + params.topLength * 0.18 - params.taper * 0.04),
      0,
      Math.max(crownHeight * 1.15, baseline.hairline),
    ),
  );
  const hairThickness = round(
    clamp(
      baseline.hairThickness * (0.78 + params.topLength * 0.16 + params.sideLength * 0.08 + params.backLength * 0.06)
        + params.messiness * 0.04,
      0,
      Math.max(crownHeight + sideWidth + backLength, baseline.hairThickness),
    ),
  );

  return { crownHeight, sideWidth, backLength, flatness, hairline, hairThickness };
}

export function buildHairMeasurementSnapshot(args: {
  source: HairMeasurementSnapshot['source'];
  baselineMeasurements: HairMeasurements;
  params: HairParams;
  revision?: number;
  bbox?: RawHairBBox;
}): HairMeasurementSnapshot {
  const { source, baselineMeasurements, params, revision = 1, bbox } = args;

  return {
    revision,
    timestamp: new Date().toISOString(),
    source,
    units: 'scene_units',
    baseline: baselineMeasurements,
    estimated: estimateFromParams(baselineMeasurements, params),
    currentParams: params,
    bbox: bbox ? normalizeBBox(bbox) : undefined,
  };
}

export function ensureMeasurementSnapshot(profile: UserHeadProfile): UserHeadProfile {
  if (profile.measurementSnapshot) return profile;

  return {
    ...profile,
    measurementSnapshot: buildHairMeasurementSnapshot({
      source: 'scan',
      baselineMeasurements: profile.hairMeasurements,
      params: profile.currentStyle.params,
    }),
  };
}
