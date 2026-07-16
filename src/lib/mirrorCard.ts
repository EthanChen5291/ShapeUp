// ============================================================
// The mirror card — the physical artifact the whole strategy hangs on.
//
// A print-resolution PNG a barber tapes to the mirror by their chair: their
// name, a QR to their /b/<slug> page, and the one line that makes a stranger
// scan it. If this doesn't survive a phone camera at arm's length, nothing else
// we built matters, so the QR is generated at high error-correction and kept
// large with a wide quiet zone.
//
// Canvas-only (no DOM), so it can be unit-tested with a stubbed 2D context.
// ============================================================

import QRCode from 'qrcode';

export const MIRROR_CARD_W = 1080;
export const MIRROR_CARD_H = 1500;

// Brand tokens, inlined — this renders to a bitmap, not the DOM, so it can't
// read CSS custom properties. Keep in step with globals.css :root.
const CREAM = '#fff8ea';
const BISCUIT = '#f6ecd8';
const INK = '#2a201a';
const TOMATO = '#d94e3a';
const CHERRY = '#a9311f';
const SMOKE = '#8a7a6a';

export interface MirrorCardText {
  /** The barber's name, big at the top. */
  displayName: string;
  /** Optional shop line under the name. */
  shopName?: string;
  /** The scannable URL, e.g. https://tryshapeup.cc/b/marcus. */
  url: string;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw the full card onto a 1080×1500 canvas. Exposed for tests + the builder. */
export async function drawMirrorCard(
  canvas: HTMLCanvasElement,
  text: MirrorCardText,
): Promise<void> {
  canvas.width = MIRROR_CARD_W;
  canvas.height = MIRROR_CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  // Background.
  ctx.fillStyle = BISCUIT;
  ctx.fillRect(0, 0, MIRROR_CARD_W, MIRROR_CARD_H);

  // Card panel.
  const pad = 70;
  ctx.fillStyle = CREAM;
  roundRect(ctx, pad, pad, MIRROR_CARD_W - pad * 2, MIRROR_CARD_H - pad * 2, 56);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(217,78,58,0.28)';
  ctx.stroke();

  const cx = MIRROR_CARD_W / 2;
  ctx.textAlign = 'center';

  // Eyebrow.
  ctx.fillStyle = CHERRY;
  ctx.font = "600 30px 'JetBrains Mono', monospace";
  ctx.fillText('SHOW ME THE CUT YOU WANT', cx, 230);

  // Barber name.
  ctx.fillStyle = INK;
  ctx.font = "800 84px Georgia, 'Fraunces', serif";
  ctx.fillText(text.displayName, cx, 340);

  if (text.shopName) {
    ctx.fillStyle = TOMATO;
    ctx.font = "700 34px 'DM Sans', sans-serif";
    ctx.fillText(text.shopName, cx, 400);
  }

  // QR — high error correction so it reads even scuffed or partly reflected.
  const qrSize = 620;
  const qrX = cx - qrSize / 2;
  const qrY = 470;
  const dataUrl = await QRCode.toDataURL(text.url, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: qrSize,
    color: { dark: INK, light: CREAM },
  });
  await drawImage(ctx, dataUrl, qrX, qrY, qrSize, qrSize);

  // Instruction under the QR.
  ctx.fillStyle = INK;
  ctx.font = "800 46px Georgia, 'Fraunces', serif";
  ctx.fillText('Scan to see it on your head', cx, qrY + qrSize + 90);

  ctx.fillStyle = SMOKE;
  ctx.font = "500 30px 'DM Sans', sans-serif";
  ctx.fillText('Preview your cut before I touch your hair', cx, qrY + qrSize + 145);

  // Footer wordmark + URL.
  ctx.fillStyle = TOMATO;
  ctx.font = "800 30px Georgia, 'Fraunces', serif";
  ctx.fillText('ShapeUp', cx, MIRROR_CARD_H - 130);
  ctx.fillStyle = SMOKE;
  ctx.font = "500 26px 'DM Sans', sans-serif";
  ctx.fillText(text.url.replace(/^https?:\/\//, ''), cx, MIRROR_CARD_H - 90);
}

function drawImage(
  ctx: CanvasRenderingContext2D,
  src: string,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, x, y, w, h);
      resolve();
    };
    img.onerror = () => reject(new Error('QR image failed to load'));
    img.src = src;
  });
}

/** Just the QR as a data URL — used for the on-screen preview. */
export function qrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 512,
    color: { dark: '#2a201a', light: '#fff8ea' },
  });
}
