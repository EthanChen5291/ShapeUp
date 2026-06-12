import { describe, expect, test } from 'vitest';
import { mockUserHeadProfile } from '@/data/mockProfile';
import {
  buildFallbackOrder,
  computeZoneDeltas,
  formatBarberOrderText,
  specForLength,
  validateBarberOrder,
} from './barberOrder';

// mock profile: taper_fade — topLength 1.0 (keep), sideLength 0.4 (-60%), backLength 0.5 (-50%)

describe('computeZoneDeltas', () => {
  test('classifies keep vs take_down from baseline→estimated measurement diff', () => {
    const ctx = computeZoneDeltas(mockUserHeadProfile);
    const byZone = Object.fromEntries(ctx.deltas.map(d => [d.zone, d]));

    expect(byZone.top.direction).toBe('keep');
    expect(byZone.sides.direction).toBe('take_down');
    expect(byZone.sides.amount).toContain('down');
    expect(byZone.back.direction).toBe('take_down');
  });

  test('confidence stays within honest bounds', () => {
    const ctx = computeZoneDeltas(mockUserHeadProfile);
    for (const d of ctx.deltas) {
      expect(d.confidence).toBeGreaterThanOrEqual(0.55);
      expect(d.confidence).toBeLessThanOrEqual(0.97);
    }
  });
});

describe('specForLength', () => {
  test('maps the 0–2 length scale to barber specs', () => {
    expect(specForLength(0.05, 'sides')).toBe('skin / #0.5');
    expect(specForLength(0.05, 'top')).toBe('buzzed, #1');
    expect(specForLength(0.4, 'sides')).toContain('#3–#4');
    expect(specForLength(1.0, 'top')).toContain('scissor');
    expect(specForLength(1.9, 'top')).toContain('4 in+');
  });
});

describe('validateBarberOrder', () => {
  const ctx = computeZoneDeltas(mockUserHeadProfile);

  test('garbage input falls back to a complete deterministic order', () => {
    const order = validateBarberOrder('not json at all', ctx, mockUserHeadProfile);
    expect(order.zones).toHaveLength(5);
    expect(order.zones.map(z => z.zone)).toEqual(['top', 'sides', 'back', 'edges', 'finish']);
    expect(order.askFor.length).toBeGreaterThan(10);
  });

  test('partial Gemini output keeps valid zones and backfills the rest', () => {
    const order = validateBarberOrder({
      styleName: 'Low Taper Crop',
      zones: [{ zone: 'top', move: 'Take an inch off, point cut the fringe.', technique: 'point cutting', spec: '~2 in', confidence: 0.9 }],
    }, ctx, mockUserHeadProfile);

    expect(order.styleName).toBe('Low Taper Crop');
    expect(order.zones[0].technique).toBe('point cutting');
    expect(order.zones).toHaveLength(5);
    expect(order.zones[1].move.length).toBeGreaterThan(0); // backfilled sides
  });

  test('blended confidence is clamped to [0.5, 0.98] even for wild model values', () => {
    const order = validateBarberOrder({
      zones: [{ zone: 'top', move: 'x', technique: 'x', spec: 'x', confidence: 42 }],
    }, ctx, mockUserHeadProfile);
    const top = order.zones.find(z => z.zone === 'top')!;
    expect(top.confidence).toBeLessThanOrEqual(0.98);
    expect(top.confidence).toBeGreaterThanOrEqual(0.5);
  });
});

describe('formatBarberOrderText', () => {
  test('prints all zones, the ask-for line, and the ticket', () => {
    const ctx = computeZoneDeltas(mockUserHeadProfile);
    const order = buildFallbackOrder(ctx, mockUserHeadProfile);
    const text = formatBarberOrderText(order, 'AB12·CD34');

    expect(text).toContain('BARBER’S ORDER');
    expect(text).toContain('ticket AB12·CD34');
    for (const z of order.zones) expect(text).toContain(z.label);
    expect(text).toContain('SAY THIS IN THE CHAIR');
  });
});
