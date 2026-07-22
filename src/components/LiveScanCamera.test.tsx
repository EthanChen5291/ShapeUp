// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { evaluateFaceCheck } from './LiveScanCamera';

const img = {} as HTMLImageElement;

describe('evaluateFaceCheck', () => {
  it('resolves "ok" when the MediaPipe landmarker finds at least one face', async () => {
    const landmarker = { detectForVideo: vi.fn(() => ({ faceLandmarks: [[{ x: 0, y: 0, z: 0 }]] })) };
    const result = await evaluateFaceCheck(img, landmarker, null);
    expect(result).toBe('ok');
    expect(landmarker.detectForVideo).toHaveBeenCalledWith(img, expect.any(Number));
  });

  it('resolves "no-face" when the landmarker returns an empty face list', async () => {
    const landmarker = { detectForVideo: vi.fn(() => ({ faceLandmarks: [] })) };
    const result = await evaluateFaceCheck(img, landmarker, null);
    expect(result).toBe('no-face');
  });

  it('falls back to the native detector when no landmarker is available', async () => {
    const native = { detect: vi.fn(async () => [{ boundingBox: {} as DOMRectReadOnly }]) };
    const result = await evaluateFaceCheck(img, null, native);
    expect(result).toBe('ok');
    expect(native.detect).toHaveBeenCalledWith(img);
  });

  it('resolves "no-face" when the native detector finds nothing', async () => {
    const native = { detect: vi.fn(async () => []) };
    const result = await evaluateFaceCheck(img, null, native);
    expect(result).toBe('no-face');
  });

  it('resolves "unchecked" when neither detector is available, so unsupported browsers never block', async () => {
    const result = await evaluateFaceCheck(img, null, null);
    expect(result).toBe('unchecked');
  });

  it('resolves "unchecked" instead of throwing when the landmarker errors mid-detection', async () => {
    const landmarker = { detectForVideo: vi.fn(() => { throw new Error('wasm not ready'); }) };
    const result = await evaluateFaceCheck(img, landmarker, null);
    expect(result).toBe('unchecked');
  });

  it('resolves "unchecked" instead of throwing when the native detector rejects', async () => {
    const native = { detect: vi.fn(async () => { throw new Error('detector crashed'); }) };
    const result = await evaluateFaceCheck(img, null, native);
    expect(result).toBe('unchecked');
  });
});
