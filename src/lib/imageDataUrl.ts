export type AllowedImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

const MIME_BY_EXT: Record<string, AllowedImageMime> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export type ParsedImageDataUrl =
  | { ok: true; buffer: Buffer; mimeType: AllowedImageMime; width: number; height: number }
  | { ok: false; error: string };

type ParseOptions = {
  maxBytes: number;
  maxPixels?: number;
  maxDimension?: number;
};

export function parseImageDataUrl(value: unknown, options: ParseOptions): ParsedImageDataUrl {
  if (typeof value !== 'string') return { ok: false, error: 'imageDataUrl is required' };
  const match = value.match(/^data:image\/(png|jpe?g|webp);base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) return { ok: false, error: 'imageDataUrl must be a base64 PNG, JPEG, or WebP data URL' };

  const mimeType = MIME_BY_EXT[match[1].toLowerCase()];
  const base64 = match[2];
  if (base64.length > Math.ceil(options.maxBytes * 4 / 3) + 128) return { ok: false, error: 'Image is too large' };

  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > options.maxBytes) return { ok: false, error: 'Image is too large' };

  const dimensions = readImageDimensions(buffer, mimeType);
  if (!dimensions) return { ok: false, error: 'Invalid or unsupported image data' };

  const maxDimension = options.maxDimension ?? 5000;
  if (dimensions.width <= 0 || dimensions.height <= 0 || dimensions.width > maxDimension || dimensions.height > maxDimension) {
    return { ok: false, error: 'Image dimensions are too large' };
  }

  const maxPixels = options.maxPixels ?? 12_000_000;
  if (dimensions.width * dimensions.height > maxPixels) return { ok: false, error: 'Image has too many pixels' };

  return { ok: true, buffer, mimeType, ...dimensions };
}

export function readImageDimensions(buffer: Buffer, mimeType: AllowedImageMime): { width: number; height: number } | null {
  if (mimeType === 'image/png') return readPngDimensions(buffer);
  if (mimeType === 'image/jpeg') return readJpegDimensions(buffer);
  return readWebpDimensions(buffer);
}

function readPngDimensions(buffer: Buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readJpegDimensions(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    if (SOF_MARKERS.has(marker)) {
      if (length < 7) return null;
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
}

function readWebpDimensions(buffer: Buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunk === 'VP8L') {
    const b0 = buffer[21], b1 = buffer[22], b2 = buffer[23], b3 = buffer[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  if (chunk === 'VP8 ' && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}

export function sanitizeOutputName(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(trimmed)) return fallback;
  return trimmed;
}
