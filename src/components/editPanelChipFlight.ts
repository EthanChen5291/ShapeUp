// Geometry for the "fly a suggestion chip into the prompt box" animation.
// Kept pure (no DOM) so the curved path can be unit-tested.

export type FlightRect = { left: number; top: number };

export type FlightKeyframe = {
  transform: string;
  opacity: number;
  offset: number;
};

/**
 * Build the keyframes for a chip flying from `start` to a point just inside the
 * top-left of the prompt box (`end`). The path bulges to the right at the
 * midpoint so it curves out right then back left to the target — never a
 * straight line — while travelling up into the box, then shrinks and fades so
 * the text appears to pop into the textarea on arrival.
 */
export function computeChipFlightKeyframes(start: FlightRect, end: FlightRect): FlightKeyframe[] {
  // Land just inside the top-left of the prompt box.
  const dx = (end.left + 14) - start.left;
  const dy = (end.top + 14) - start.top;
  // Rightward bulge at the midpoint, scaled to the horizontal travel.
  const bulge = Math.max(36, Math.abs(dx) * 0.4);

  return [
    { transform: 'translate(0px, 0px) scale(1)', opacity: 1, offset: 0 },
    { transform: `translate(${dx * 0.35 + bulge}px, ${dy * 0.55}px) scale(0.92)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.55)`, opacity: 0, offset: 1 },
  ];
}

export const CHIP_FLIGHT_OPTIONS: KeyframeAnimationOptions = {
  duration: 520,
  easing: 'cubic-bezier(0.45, 0, 0.2, 1)',
  fill: 'forwards',
};
