// ============================================================
// mediapipeToProfile — pure conversion utility (no browser APIs)
//
// Converts raw MediaPipe FaceMesh landmarks + SelfieSegmentation
// mask into a UserHeadProfile in Three.js scene units.
//
// Canonical scale: ear-to-ear is always locked to 1.6 scene units.
// All other measurements derive from that ratio.
// ============================================================

import { UserHeadProfile, HairPreset, HairParams } from '@/types';
import { HAIR_PRESETS } from '@/data/mockProfile';

export interface RawScanData {
  landmarks: Array<{ x: number; y: number; z: number }>; // normalized 0–1
  segmentationMask: ImageData;                            // RGBA pixel data
  hairType: 'straight' | 'wavy' | 'curly';
  imageWidth: number;
  imageHeight: number;
}

// Returned alongside the profile so ScanCamera can compute depth
export interface ScanMeta {
  pxToScene: number;
  earToEarPx: number;
}

// ── Constants ──────────────────────────────────────────────

const CANONICAL_EAR_WIDTH = 1.6; // scene units
const FRAMES_TO_COLLECT   = 15;

// Key landmark indices (MediaPipe FaceMesh 468-point model)
const LM_CROWN    = 10;
const LM_EAR_L    = 234;
const LM_EAR_R    = 454;
const LM_CHIN     = 152;

// ── Coordinate conversion ──────────────────────────────────

interface PxPoint { x: number; y: number }

function toPx(
  lm: { x: number; y: number },
  imageWidth: number,
  imageHeight: number
): PxPoint {
  return { x: lm.x * imageWidth, y: lm.y * imageHeight };
}

/**
 * Convert a MediaPipe pixel point to Three.js scene coordinates.
 *
 * Origin is the midpoint between the two ear landmarks.
 * MP y increases downward; Three.js y increases upward → invert Y.
 */
function mpToScene(
  px: PxPoint,
  centerPx: PxPoint,
  pxToScene: number
): [number, number, number] {
  return [
    (px.x - centerPx.x) * pxToScene,   // x: left = negative
    -(px.y - centerPx.y) * pxToScene,  // y: inverted (up = positive)
    0,                                  // z: no reliable depth from frontal view
  ];
}

// ── Hair measurements from segmentation mask ───────────────

function extractHairMeasurements(
  mask: ImageData,
  crownPx: PxPoint,
  chinPx: PxPoint,
  earLPx: PxPoint,
  earRPx: PxPoint,
  pxToScene: number,
  hairType: 'straight' | 'wavy' | 'curly'
) {
  const { data, width: imgW } = mask;

  const headH_px = chinPx.y - crownPx.y;
  const headW_px = earRPx.x - earLPx.x;

  // Scan the top 35% of the head bounding box for hair pixels
  const scanTop    = Math.max(0, Math.floor(crownPx.y - headH_px * 0.1)); // a bit above crown
  const scanBottom = Math.floor(crownPx.y + headH_px * 0.35);
  const scanLeft   = Math.max(0, Math.floor(earLPx.x - headW_px * 0.2));
  const scanRight  = Math.min(mask.width - 1, Math.floor(earRPx.x + headW_px * 0.2));

  let highestY_px   = scanBottom;
  let sideMostL_px  = scanRight;
  let sideMostR_px  = scanLeft;
  let hairPixels    = 0;
  const totalPixels = Math.max(1, (scanRight - scanLeft) * (scanBottom - scanTop));

  for (let py = scanTop; py <= scanBottom; py++) {
    for (let px = scanLeft; px <= scanRight; px++) {
      const idx   = (py * imgW + px) * 4;
      const alpha = data[idx + 3]; // SelfieSegmentation writes foreground to alpha
      if (alpha > 128) {
        hairPixels++;
        if (py < highestY_px) highestY_px = py;
        if (px < sideMostL_px) sideMostL_px = px;
        if (px > sideMostR_px) sideMostR_px = px;
      }
    }
  }

  const crownHeight = Math.max(0, (crownPx.y - highestY_px) * pxToScene);
  const detectedW   = Math.max(0, sideMostR_px - sideMostL_px);
  const sideWidth   = Math.max(0, (detectedW - headW_px) * 0.5 * pxToScene);
  const flatness    = Math.min(1, hairPixels / totalPixels);

  // Camera can't see the back; use hair-type heuristic
  const backLength =
    hairType === 'curly' ? 0.4 :
    hairType === 'wavy'  ? 0.3 : 0.25;

  const hairline = Math.max(0, crownHeight * 0.8);
  const hairThickness = Math.max(0, crownHeight * 0.25 + sideWidth * 0.5 + backLength * 0.25);

  return { crownHeight, sideWidth, backLength, flatness, hairline, hairThickness };
}

// ── Preset inference ───────────────────────────────────────

function inferPreset(hairType: 'straight' | 'wavy' | 'curly'): HairPreset {
  if (hairType === 'curly') return 'afro';
  if (hairType === 'wavy')  return 'waves';
  return 'default';
}

// ── Main conversion ────────────────────────────────────────

export function mediapipeToProfile(scan: RawScanData): UserHeadProfile & { _meta: ScanMeta } {
  const { landmarks: lms, segmentationMask, hairType, imageWidth, imageHeight } = scan;

  // Pixel positions of key landmarks
  const crownPx  = toPx(lms[LM_CROWN], imageWidth, imageHeight);
  const earLPx   = toPx(lms[LM_EAR_L], imageWidth, imageHeight);
  const earRPx   = toPx(lms[LM_EAR_R], imageWidth, imageHeight);
  const chinPx   = toPx(lms[LM_CHIN],  imageWidth, imageHeight);

  // Scene origin = midpoint between ears
  const centerPx: PxPoint = {
    x: (earLPx.x + earRPx.x) / 2,
    y: (earLPx.y + earRPx.y) / 2,
  };

  // Scale factor: lock ear-to-ear to 1.6 scene units
  const earToEar_px = Math.abs(earRPx.x - earLPx.x);
  const pxToScene   = CANONICAL_EAR_WIDTH / Math.max(earToEar_px, 1);

  // Head proportions
  const crownToChin_px = Math.abs(chinPx.y - crownPx.y);
  const headHeight     = crownToChin_px * pxToScene;
  // crownY: crown is ABOVE center (center is at ears ≈ y=0)
  const crownY         = -(crownPx.y - centerPx.y) * pxToScene; // positive because crown is above ears

  // Ear anchors in scene space
  const earLeft  = mpToScene(earLPx,  centerPx, pxToScene);
  const earRight = mpToScene(earRPx,  centerPx, pxToScene);

  // Hair measurements from segmentation mask
  const hairMeasurements = extractHairMeasurements(
    segmentationMask,
    crownPx, chinPx, earLPx, earRPx,
    pxToScene,
    hairType
  );

  const preset = inferPreset(hairType);
  const params: HairParams = HAIR_PRESETS[preset];

  return {
    headProportions: {
      width:  CANONICAL_EAR_WIDTH, // always 1.6 (canonical)
      height: headHeight,
      crownY,
    },
    anchors: {
      earLeft:  earLeft  as [number, number, number],
      earRight: earRight as [number, number, number],
    },
    hairMeasurements,
    currentStyle: {
      preset,
      hairType,
      colorRGB: '#3b1f0a',
      params,
    },
    _meta: { pxToScene, earToEarPx: earToEar_px },
  };
}

// ── Frame averaging ────────────────────────────────────────

export function averageProfiles(profiles: UserHeadProfile[]): UserHeadProfile {
  if (profiles.length === 0) throw new Error('No profiles to average');
  if (profiles.length === 1) return profiles[0];

  const n   = profiles.length;
  const avg = (fn: (p: UserHeadProfile) => number) =>
    profiles.reduce((sum, p) => sum + fn(p), 0) / n;

  return {
    headProportions: {
      width:  avg(p => p.headProportions.width),
      height: avg(p => p.headProportions.height),
      crownY: avg(p => p.headProportions.crownY),
    },
    anchors: {
      earLeft: [
        avg(p => p.anchors.earLeft[0]),
        avg(p => p.anchors.earLeft[1]),
        avg(p => p.anchors.earLeft[2]),
      ] as [number, number, number],
      earRight: [
        avg(p => p.anchors.earRight[0]),
        avg(p => p.anchors.earRight[1]),
        avg(p => p.anchors.earRight[2]),
      ] as [number, number, number],
    },
    hairMeasurements: {
      crownHeight: avg(p => p.hairMeasurements.crownHeight),
      sideWidth:   avg(p => p.hairMeasurements.sideWidth),
      backLength:  avg(p => p.hairMeasurements.backLength),
      flatness:    avg(p => p.hairMeasurements.flatness),
      hairline:    avg(p => p.hairMeasurements.hairline),
      hairThickness: avg(p => p.hairMeasurements.hairThickness),
    },
    currentStyle: profiles[profiles.length - 1].currentStyle,
  };
}

export { FRAMES_TO_COLLECT };
