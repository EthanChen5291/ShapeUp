// Mobile suggestion-chip selection logic, kept pure for unit testing.
//
// On mobile a chip can't be hovered, so tapping a chip *selects* it: the border
// glows and its preview stays up until the user taps another chip or taps the
// same one again (which un-selects it). Pressing Apply then applies the selected
// chip's text rather than whatever is in the prompt box.

/** Next selection after a tap: same chip toggles off, a different chip selects. */
export function nextSelectedChip(current: string | null, tapped: string): string | null {
  return current === tapped ? null : tapped;
}

/** Which text Apply should run — the selected chip wins on mobile. */
export function resolveApplyPrompt(
  isMobile: boolean,
  selectedChip: string | null,
  prompt: string,
): string {
  return isMobile && selectedChip ? selectedChip : prompt;
}
