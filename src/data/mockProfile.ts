// ============================================================
// Mock UserHeadProfile — use this during development so you
// don't need a live camera/MediaPipe stream.
//
// Values are roughly calibrated to a "medium build" head in a
// Three.js scene where the head sphere has radius ≈ 1.0.
// ============================================================

import { UserHeadProfile } from '@/types';
import { ensureMeasurementSnapshot } from '@/lib/hairMeasurementSnapshot';

export const mockUserHeadProfile: UserHeadProfile = ensureMeasurementSnapshot({
  headProportions: {
    width: 1.6,     // ~16 cm → 1.6 scene units
    height: 2.2,
    crownY: 1.1,    // top of head in scene space (head centered at origin)
  },
  anchors: {
    earLeft:  [-0.85, 0.0, 0.0],
    earRight: [ 0.85, 0.0, 0.0],
  },
  hairMeasurements: {
    crownHeight: 0.4,
    sideWidth:   0.2,
    backLength:  0.3,
    flatness:    0.5,
    hairline:    0.32,
    hairThickness: 0.18,
  },
  currentStyle: {
    preset: 'taper_fade',
    hairType: 'straight',
    colorRGB: '#3b1f0a',
    params: {
      topLength:  1.0,
      sideLength: 0.4,
      backLength: 0.5,
      messiness:  0.2,
      taper:      0.6,
      pc1: 0, pc2: 0, pc3: 0, pc4: 0, pc5: 0, pc6: 0,
    },
  },
});

const pc0 = { pc1: 0, pc2: 0, pc3: 0, pc4: 0, pc5: 0, pc6: 0 };

// Preset library — closest-match lookup used in RENDER phase
export const HAIR_PRESETS: Record<string, typeof mockUserHeadProfile.currentStyle.params> = {
  buzz:       { topLength: 0.2, sideLength: 0.1, backLength: 0.1, messiness: 0.05, taper: 0.1, ...pc0 },
  pompadour:  { topLength: 1.8, sideLength: 0.3, backLength: 0.5, messiness: 0.15, taper: 0.7, ...pc0 },
  undercut:   { topLength: 1.5, sideLength: 0.1, backLength: 0.3, messiness: 0.1,  taper: 0.9, ...pc0 },
  taper_fade: { topLength: 1.0, sideLength: 0.4, backLength: 0.5, messiness: 0.2,  taper: 0.6, ...pc0 },
  afro:       { topLength: 1.8, sideLength: 1.6, backLength: 1.4, messiness: 0.8,  taper: 0.1, ...pc0 },
  waves:      { topLength: 0.4, sideLength: 0.4, backLength: 0.4, messiness: 0.5,  taper: 0.3, ...pc0 },
  default:    { topLength: 1.0, sideLength: 1.0, backLength: 1.0, messiness: 0.2,  taper: 0.4, ...pc0 },
};
