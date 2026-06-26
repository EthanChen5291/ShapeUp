/**
 * Classify a vertical touch gesture from its start/end Y coordinates.
 *
 * Touch Y grows downward, so an upward swipe means the finger ended *above*
 * where it started (endY < startY). Movement smaller than `threshold` pixels is
 * treated as a tap, not a swipe.
 */
export function verticalSwipe(
  startY: number,
  endY: number,
  threshold = 40,
): 'up' | 'down' | null {
  const delta = startY - endY;
  if (delta > threshold) return 'up';
  if (delta < -threshold) return 'down';
  return null;
}
