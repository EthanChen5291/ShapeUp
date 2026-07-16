// ============================================================
// Selfie quality checks for the barber-card try-on.
//
// Split in two so the rules are unit-testable without a browser:
//  - judgeSelfie(metrics)  — pure verdict logic (selfieCheck.test.ts)
//  - analyzeSelfie(blob)   — browser-side extractor: decodes the image,
//    samples brightness on a small canvas, and asks the native FaceDetector
//    (Chrome/Android — exactly the phones pointed at a mirror QR) when it
//    exists. Face detection is best-effort: when the API is missing the
//    verdict falls back to brightness/size rules alone rather than blocking.
//
// Verdict levels: 'fail' asks for a retake, 'warn' lets the client proceed
// anyway ("Use this photo"), 'ok' continues automatically. Copy is terse on
// purpose — guidance, not a lecture.
// ============================================================

export type SelfieLevel = 'ok' | 'warn' | 'fail';

export interface SelfieVerdict {
  level: SelfieLevel;
  /** Source-language (EN) guidance string — render through t(). */
  message: string;
}

export interface SelfieMetrics {
  width: number;
  height: number;
  /** Mean luma over a downsampled grid, 0–255. */
  meanLuma: number;
  /** Fraction of sampled pixels that are nearly black (< 16). */
  clippedDark: number;
  /** Fraction of sampled pixels that are nearly white (> 239). */
  clippedBright: number;
  /**
   * Largest detected face box in image pixels.
   * `undefined` — detection unavailable (no FaceDetector API): skip face rules.
   * `null` — detection ran and found no face.
   */
  face?: { x: number; y: number; width: number; height: number } | null;
}

/** Shortest side below this and the render model has too little to work with. */
const MIN_SIDE_PX = 400;

export function judgeSelfie(m: SelfieMetrics): SelfieVerdict {
  if (Math.min(m.width, m.height) < MIN_SIDE_PX) {
    return { level: 'fail', message: 'Move slightly closer' };
  }
  if (m.meanLuma < 50 || m.clippedDark > 0.5) {
    return { level: 'fail', message: 'Use even lighting' };
  }
  if (m.meanLuma > 215 || m.clippedBright > 0.5) {
    return { level: 'warn', message: 'Use even lighting' };
  }

  if (m.face === null) {
    return { level: 'fail', message: 'Face the camera' };
  }
  if (m.face) {
    const faceFrac = m.face.width / m.width;
    if (faceFrac < 0.18) {
      return { level: 'fail', message: 'Move slightly closer' };
    }
    if (faceFrac > 0.75) {
      return { level: 'warn', message: 'Keep your full head in frame' };
    }
    // The detector boxes the face only; hair sits above it. A face box pressed
    // against the top edge means the hairline is almost certainly cropped —
    // and the hairline is the one part this product cannot do without.
    if (m.face.y < m.height * 0.02) {
      return { level: 'fail', message: 'Hairline not visible' };
    }
    if (m.face.y < m.height * 0.1) {
      return { level: 'warn', message: 'Keep your full head in frame' };
    }
  }

  return { level: 'ok', message: 'Photo looks good' };
}

// ── browser-side extractor ──────────────────────────────────

/** Sampling canvas size — stats only need a coarse grid, not the full image. */
const SAMPLE_SIZE = 128;

interface DetectedFace {
  boundingBox: { x: number; y: number; width: number; height: number };
}
interface FaceDetectorLike {
  detect(image: CanvasImageSource): Promise<DetectedFace[]>;
}

async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Some browsers reject exotic encodings here but decode fine via <img>.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image failed to decode'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sizeOf(img: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  return 'naturalWidth' in img
    ? { width: img.naturalWidth, height: img.naturalHeight }
    : { width: img.width, height: img.height };
}

/**
 * Decode + measure a candidate selfie. Throws only if the blob isn't a
 * decodable image; every measurement failure degrades to "unknown" instead.
 */
export async function analyzeSelfie(blob: Blob): Promise<SelfieMetrics> {
  const img = await decode(blob);
  const { width, height } = sizeOf(img);

  let meanLuma = 128;
  let clippedDark = 0;
  let clippedBright = 0;
  try {
    const canvas = document.createElement('canvas');
    const scale = SAMPLE_SIZE / Math.max(width, height, 1);
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let sum = 0;
      let dark = 0;
      let bright = 0;
      const pixels = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        sum += luma;
        if (luma < 16) dark++;
        else if (luma > 239) bright++;
      }
      meanLuma = sum / pixels;
      clippedDark = dark / pixels;
      clippedBright = bright / pixels;
    }
  } catch {
    // jsdom / canvas-less environments: keep the neutral defaults above.
  }

  let face: SelfieMetrics['face'];
  const FaceDetectorCtor = (globalThis as { FaceDetector?: new (opts?: object) => FaceDetectorLike })
    .FaceDetector;
  if (FaceDetectorCtor) {
    try {
      const detector = new FaceDetectorCtor({ fastMode: true, maxDetectedFaces: 4 });
      const faces = await detector.detect(img as CanvasImageSource);
      if (faces.length === 0) {
        face = null;
      } else {
        const biggest = faces.reduce((a, b) =>
          a.boundingBox.width * a.boundingBox.height >= b.boundingBox.width * b.boundingBox.height ? a : b,
        );
        const b = biggest.boundingBox;
        face = { x: b.x, y: b.y, width: b.width, height: b.height };
      }
    } catch {
      face = undefined; // detector present but failed — skip face rules
    }
  }

  if ('close' in img) img.close();
  return { width, height, meanLuma, clippedDark, clippedBright, face };
}
