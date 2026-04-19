import { buildHairMeasurementSnapshot } from '@/lib/hairMeasurementSnapshot';
import { UserHeadProfile } from '@/types';

export function buildCurrentProfilePayload(profile: UserHeadProfile) {
  const measurementSnapshot = buildHairMeasurementSnapshot({
    source: profile.measurementSnapshot?.source ?? 'derived_params',
    baselineMeasurements: profile.hairMeasurements,
    params: profile.currentStyle.params,
    revision: profile.measurementSnapshot?.revision ?? 1,
    bbox: profile.measurementSnapshot?.bbox,
  });

  return {
    headProportions: profile.headProportions,
    hairMeasurements: profile.hairMeasurements,
    measurementSnapshot,
    currentStyle: profile.currentStyle,
  };
}
