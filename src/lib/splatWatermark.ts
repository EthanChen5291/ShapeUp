// ============================================================
// splatWatermark — renders the ShapeUp corner lockup (comb mascot + "shapeup"
// wordmark) to a canvas so it can be composited into exported 360° clips.
//
// Mirrors the landing-page nav corner: the comb mascot beside a Fraunces-900
// wordmark, "shape" then an italic "up" in tomato. On the dark studio clips the
// "shape" half is drawn in cream (rather than the landing's ink) so it stays
// legible, and the whole mark carries a soft drop shadow for mixed backgrounds.
//
//   const wm = await createWatermark({ videoHeight: outH });
//   if (wm) ctx.drawImage(wm.canvas, margin, outH - wm.height - margin);
// ============================================================

const LOGO_SRC = '/shapeup_logo.png'; // comb mascot in a tomato badge
const TOMATO = '#d94e3a';             // --tomato
const CREAM = '#fff8ea';              // --cream

/** Proportions of the lockup, all derived from the target video height. Pure so
 *  it can be unit-tested without a DOM. */
export interface WatermarkLayout {
  iconH: number;    // comb badge is the tallest element
  fontPx: number;   // wordmark cap height
  gap: number;      // space between badge and wordmark
  margin: number;   // inset from the video corner
  pad: number;      // breathing room around the mark for the shadow
  shadowBlur: number;
  shadowOffsetY: number;
}

export function computeWatermarkLayout(videoHeight: number): WatermarkLayout {
  // Anchor the mark to ~8% of the frame height, with a floor so tiny renders
  // still get a readable badge.
  const iconH = Math.max(28, Math.round(videoHeight * 0.08));
  const fontPx = Math.round(iconH * 0.62);
  return {
    iconH,
    fontPx,
    gap: Math.round(iconH * 0.16),
    margin: Math.max(12, Math.round(videoHeight * 0.035)),
    pad: Math.ceil(fontPx * 0.4),
    shadowBlur: Math.max(2, Math.round(fontPx * 0.14)),
    shadowOffsetY: Math.max(1, Math.round(fontPx * 0.06)),
  };
}

export interface Watermark {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Inset from the frame corner the caller should draw the mark at. */
  margin: number;
}

let logoPromise: Promise<HTMLImageElement> | null = null;
function loadLogo(): Promise<HTMLImageElement> {
  if (!logoPromise) {
    logoPromise = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = LOGO_SRC;
    });
  }
  return logoPromise;
}

/** next/font hashes the family name (e.g. "__Fraunces_ab12"), so read the real
 *  resolved stack off a probe carrying the same class the wordmark uses. */
function resolveFraunces(): string {
  const probe = document.createElement('span');
  probe.className = 'font-display';
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const family = getComputedStyle(probe).fontFamily || 'Georgia, serif';
  probe.remove();
  return family;
}

/** Build the watermark bitmap once; returns null when there's no DOM (SSR) or
 *  the logo/canvas is unavailable. Rendering failures degrade to text-only. */
export async function createWatermark(opts: { videoHeight: number }): Promise<Watermark | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;

  const { iconH, fontPx, gap, margin, pad, shadowBlur, shadowOffsetY } = computeWatermarkLayout(opts.videoHeight);
  const family = resolveFraunces();

  // Give the browser a chance to have the faces ready before we measure/draw.
  try {
    await Promise.all([
      document.fonts.load(`900 ${fontPx}px ${family}`),
      document.fonts.load(`italic 900 ${fontPx}px ${family}`),
    ]);
  } catch { /* fall back to whatever's available */ }

  const logo = await loadLogo().catch(() => null);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const shapeFont = `900 ${fontPx}px ${family}`;
  const upFont = `italic 900 ${fontPx}px ${family}`;
  const supportsSpacing = 'letterSpacing' in ctx;
  const spacing = `${Math.round(-fontPx * 0.035)}px`;

  // Measure the wordmark so we can size the canvas.
  ctx.font = shapeFont;
  if (supportsSpacing) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = spacing;
  const shapeW = ctx.measureText('shape').width;
  ctx.font = upFont;
  const upW = ctx.measureText('up').width;
  const textW = shapeW + upW;

  const iconSlot = logo ? iconH + gap : 0;
  const width = Math.ceil(pad + iconSlot + textW + pad);
  const height = pad + iconH + pad;
  canvas.width = width;
  canvas.height = height;

  // getContext resets state after resize, so configure again.
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = shadowBlur;
  ctx.shadowOffsetY = shadowOffsetY;

  const midY = pad + iconH / 2;
  if (logo) ctx.drawImage(logo, pad, pad, iconH, iconH);

  let x = pad + iconSlot;
  if (supportsSpacing) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = spacing;
  ctx.font = shapeFont;
  ctx.fillStyle = CREAM;
  ctx.fillText('shape', x, midY);
  x += shapeW;
  ctx.font = upFont;
  ctx.fillStyle = TOMATO;
  ctx.fillText('up', x, midY);

  return { canvas, width, height, margin };
}
