import { describe, expect, test } from 'vitest';
import { parseImageDataUrl, sanitizeOutputName } from './imageDataUrl';

function pngDataUrl(width = 1, height = 1) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

describe('image data URL validation', () => {
  test('accepts a bounded PNG data URL and returns dimensions', () => {
    const parsed = parseImageDataUrl(pngDataUrl(320, 240), { maxBytes: 1024 });

    expect(parsed).toMatchObject({
      ok: true,
      mimeType: 'image/png',
      width: 320,
      height: 240,
    });
  });

  test('rejects mismatched declared MIME and image bytes', () => {
    const parsed = parseImageDataUrl('data:image/png;base64,AAAA', { maxBytes: 1024 });

    expect(parsed).toMatchObject({
      ok: false,
      error: 'Invalid or unsupported image data',
    });
  });

  test('rejects oversized dimensions to guard decompression bombs', () => {
    const parsed = parseImageDataUrl(pngDataUrl(9000, 9000), { maxBytes: 1024 });

    expect(parsed).toMatchObject({
      ok: false,
      error: 'Image dimensions are too large',
    });
  });

  test('sanitizes local output names before writing public artifacts', () => {
    expect(sanitizeOutputName('../../public/pwned', 'edit-output')).toBe('edit-output');
    expect(sanitizeOutputName('scan_123-output', 'edit-output')).toBe('scan_123-output');
  });
});
