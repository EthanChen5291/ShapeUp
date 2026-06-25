import { describe, it, expect } from 'vitest';
import { computeChipFlightKeyframes, CHIP_FLIGHT_OPTIONS } from './editPanelChipFlight';

// Chip sits below and to the left of the prompt box, as it does in the studio loop.
const start = { left: 80, top: 400 };
const end = { left: 60, top: 120 };

function translateOf(transform: string): { x: number; y: number } {
  const m = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
  if (!m) throw new Error(`no translate in "${transform}"`);
  return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
}

describe('computeChipFlightKeyframes', () => {
  const frames = computeChipFlightKeyframes(start, end);

  it('starts at the chip and ends inside the prompt box', () => {
    expect(frames[0].offset).toBe(0);
    expect(translateOf(frames[0].transform)).toEqual({ x: 0, y: 0 });

    const last = translateOf(frames[2].transform);
    expect(last.x).toBeCloseTo(end.left + 14 - start.left); // -6
    expect(last.y).toBeCloseTo(end.top + 14 - start.top); // -266
  });

  it('travels upward into the box', () => {
    expect(translateOf(frames[2].transform).y).toBeLessThan(0);
    expect(translateOf(frames[1].transform).y).toBeLessThan(0);
  });

  it('curves out to the right at the midpoint rather than going straight', () => {
    const dxEnd = end.left + 14 - start.left;
    const linearMidX = dxEnd * 0.5;
    const midX = translateOf(frames[1].transform).x;
    // Midpoint bows well to the right of the straight-line path.
    expect(midX).toBeGreaterThan(linearMidX + 30);
    // ...then comes back left to land near the start x.
    expect(translateOf(frames[2].transform).x).toBeLessThan(midX);
  });

  it('shrinks and fades so the text pops into the box on arrival', () => {
    expect(frames[2].opacity).toBe(0);
    expect(frames[0].transform).toContain('scale(1)');
    expect(frames[2].transform).toContain('scale(0.55)');
  });

  it('is quick but smooth', () => {
    expect(CHIP_FLIGHT_OPTIONS.duration).toBeLessThanOrEqual(600);
    expect(CHIP_FLIGHT_OPTIONS.easing).toMatch(/cubic-bezier/);
  });
});
