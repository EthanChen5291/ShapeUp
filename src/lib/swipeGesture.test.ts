import { describe, expect, it } from 'vitest';
import { verticalSwipe } from './swipeGesture';

describe('verticalSwipe', () => {
  it('detects an upward swipe (finger moves up past threshold)', () => {
    expect(verticalSwipe(300, 200)).toBe('up');
  });

  it('detects a downward swipe (finger moves down past threshold)', () => {
    expect(verticalSwipe(200, 320)).toBe('down');
  });

  it('treats sub-threshold movement as a tap (null)', () => {
    expect(verticalSwipe(200, 180)).toBeNull();
    expect(verticalSwipe(200, 220)).toBeNull();
    expect(verticalSwipe(200, 200)).toBeNull();
  });

  it('honors a custom threshold', () => {
    expect(verticalSwipe(200, 190, 5)).toBe('up');
    expect(verticalSwipe(200, 190, 20)).toBeNull();
  });

  it('uses an exclusive boundary at exactly the threshold', () => {
    // delta of exactly +40 / -40 is not yet a swipe.
    expect(verticalSwipe(240, 200)).toBeNull();
    expect(verticalSwipe(200, 240)).toBeNull();
  });
});
