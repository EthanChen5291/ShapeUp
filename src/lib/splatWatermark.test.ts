import { describe, it, expect } from 'vitest';
import { computeWatermarkLayout } from './splatWatermark';

describe('computeWatermarkLayout', () => {
  it('anchors the badge to ~8% of the frame height', () => {
    const { iconH } = computeWatermarkLayout(1080);
    expect(iconH).toBe(86); // round(1080 * 0.08)
  });

  it('keeps the wordmark smaller than the badge', () => {
    const { iconH, fontPx } = computeWatermarkLayout(1080);
    expect(fontPx).toBeLessThan(iconH);
    expect(fontPx).toBe(53); // round(86 * 0.62)
  });

  it('scales every dimension up with a taller frame', () => {
    const small = computeWatermarkLayout(480);
    const large = computeWatermarkLayout(1080);
    for (const key of ['iconH', 'fontPx', 'gap', 'margin', 'pad'] as const) {
      expect(large[key]).toBeGreaterThan(small[key]);
    }
  });

  it('enforces legible floors on tiny frames', () => {
    const { iconH, margin } = computeWatermarkLayout(120);
    expect(iconH).toBeGreaterThanOrEqual(28);
    expect(margin).toBeGreaterThanOrEqual(12);
  });

  it('gives the shadow non-zero blur and offset', () => {
    const { shadowBlur, shadowOffsetY } = computeWatermarkLayout(1080);
    expect(shadowBlur).toBeGreaterThan(0);
    expect(shadowOffsetY).toBeGreaterThan(0);
  });
});
