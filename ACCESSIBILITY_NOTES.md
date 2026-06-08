# Accessibility Notes

ShapeUp targets WCAG 2.1 AA. This note captures the current implementation status and review items.

- Added global visible focus styling for keyboard users.
- Expanded `prefers-reduced-motion` handling to cover all CSS animations and transitions.
- Added semantic legal pages and a labelled hair editor control region.
- Added polite screen-reader announcements for hair edit progress, 3D readiness, and barber summary actions.
- Documented the lime contrast issue: `#B8E04A` on white is not AA-compliant for normal text. Use an approved darker accent such as `#6B8700` on white after design review.

Recommended manual QA before production: keyboard-only navigation through scan, edit, payment, and deletion flows; VoiceOver/NVDA pass on the editor; and a contrast audit of every CTA state.
