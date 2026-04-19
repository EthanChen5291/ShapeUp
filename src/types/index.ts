// ============================================================
// Core Data Contract — DO NOT modify without team consensus
// This schema is the single source of truth across all phases.
// ============================================================

export interface HairParams {
  topLength: number;    // 0.0 – 2.0  (scale of Top mesh group)
  sideLength: number;   // 0.0 – 2.0  (scale of Sides mesh group)
  backLength: number;   // 0.0 – 2.0  (scale of Back mesh group)
  messiness: number;    // 0.0 – 1.0  (vertex-jitter noise amplitude)
  taper: number;        // 0.0 – 1.0  (gradient falloff from crown)
  pc1: number;          // PCA component 1
  pc2: number;          // PCA component 2
  pc3: number;          // PCA component 3
  pc4: number;          // PCA component 4
  pc5: number;          // PCA component 5
  pc6: number;          // PCA component 6
}

export interface ARFaceMesh {
  // TrueDepth capture from iOS ARFaceGeometry (1220 vertices, real depth)
  vertices:  number[][];   // (1220, 3) — ARKit camera space, metres
  indices:   number[][];   // (N, 3)   — triangle faces
  capturedAt: string;
}

export interface FaceFrame {
  landmarks: Array<{ x: number; y: number; z: number }>;
  imageDataUrl: string;
  maskDataUrl?: string;
  imageWidth: number;
  imageHeight: number;
  yawAbs?: number;
  frontFrameIndex?: number;
}

export interface FaceScanData {
  // Raw MediaPipe landmarks at scan completion (468 points, normalized 0–1)
  landmarks: FaceFrame['landmarks'];
  // Base64 snapshot of the camera frame (used as face texture)
  imageDataUrl: FaceFrame['imageDataUrl'];
  maskDataUrl?: FaceFrame['maskDataUrl'];
  // Image dimensions the landmarks were captured at
  imageWidth: FaceFrame['imageWidth'];
  imageHeight: FaceFrame['imageHeight'];
  // Additional frontal frames captured during scan for classifier ensembling
  classifierFrames?: FaceFrame[];
  // Optional high-fidelity TrueDepth mesh — preferred over landmarks when present
  arMesh?: ARFaceMesh;
}

export interface UserHeadProfile {
  // ── Scan Phase Output (MediaPipe) ──────────────────────────
  headProportions: {
    width: number;    // Three.js scene units
    height: number;
    crownY: number;   // Y coord of crown in scene space
  };
  anchors: {
    earLeft: [number, number, number];   // [x, y, z]
    earRight: [number, number, number];
  };
  hairMeasurements: {
    crownHeight: number;   // how tall the hair sits above crown
    sideWidth: number;
    backLength: number;
    flatness: number;      // 0 = very flat, 1 = very voluminous
  };

  // ── Optional face mesh data (when full scan is performed) ──
  faceScanData?: FaceScanData;

  // ── State for RENDER + EDIT phases ─────────────────────────
  currentStyle: {
    preset: HairPreset;
    hairType: 'straight' | 'wavy' | 'curly';
    colorRGB: string;   // hex e.g. "#3b1f0a"
    params: HairParams;
  };
}

export type HairPreset =
  | 'buzz'
  | 'pompadour'
  | 'undercut'
  | 'taper_fade'
  | 'afro'
  | 'waves'
  | 'default';

// LLM Edit Loop response — only the mutable slice
export interface LLMEditResponse {
  preset?: HairPreset;
  params: HairParams;
}
