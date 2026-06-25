'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Shared slug logic — MUST match scripts/generate-hair-previews.mjs so the
// chip label maps to the file the batch generator wrote.
export function slugForCut(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export type CutPreview = {
  /** The chip label, e.g. "low taper fade, textured fringe" */
  label: string;
  /** Viewport-space anchor: the hovered chip's bounding rect. */
  left: number;
  right: number;
  centerY: number;
};

const SIZE = 168;        // circle diameter (semi-medium)
const GAP = 18;          // distance from the chip
const EDGE = 10;         // viewport padding when clamping

/**
 * A circular hairstyle preview that smooth-lerps out from a hovered chip,
 * sliding left and scaling up. Rendered to a portal so panel overflow can't
 * clip it. Pass `preview={null}` to dismiss (it fades back into the chip).
 */
export default function HairPreviewBubble({ preview }: { preview: CutPreview | null }) {
  const [mounted, setMounted] = useState(false);
  // The preview we actually render — kept populated during the exit fade so
  // the image doesn't vanish mid-animation.
  const [shown, setShown] = useState<CutPreview | null>(null);
  const [active, setActive] = useState(false);
  const [errored, setErrored] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (preview) {
      if (exitTimer.current) { clearTimeout(exitTimer.current); exitTimer.current = null; }
      setErrored(false);
      setShown(preview);
      // Two frames so the enter transition runs from the collapsed state.
      requestAnimationFrame(() => requestAnimationFrame(() => setActive(true)));
    } else {
      setActive(false);
      exitTimer.current = setTimeout(() => setShown(null), 280);
    }
  }, [preview]);

  useEffect(() => () => { if (exitTimer.current) clearTimeout(exitTimer.current); }, []);

  if (!mounted || !shown || errored) return null;

  // Resting position: a circle's-worth to the LEFT of the chip. If there isn't
  // room on the left, flip to the right edge instead.
  let left = shown.left - GAP - SIZE;
  let originX = 'right';
  if (left < EDGE) {
    left = shown.right + GAP;
    originX = 'left';
  }
  // Keep it on-screen vertically.
  const top = Math.min(
    Math.max(shown.centerY - SIZE / 2, EDGE),
    (typeof window !== 'undefined' ? window.innerHeight : 800) - SIZE - EDGE,
  );

  const slug = slugForCut(shown.label);

  return createPortal(
    <div
      aria-hidden
      style={{
        position: 'fixed',
        left,
        top,
        width: SIZE,
        height: SIZE,
        zIndex: 9999,
        pointerEvents: 'none',
        transformOrigin: `${originX} center`,
        transform: active
          ? 'translateX(0) scale(1)'
          : `translateX(${originX === 'right' ? 22 : -22}px) scale(0.5)`,
        opacity: active ? 1 : 0,
        transition:
          'transform 360ms cubic-bezier(0.22, 1, 0.36, 1), opacity 240ms ease-out',
        willChange: 'transform, opacity',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          overflow: 'hidden',
          background: 'var(--chalk, #f4f1ea)',
          border: '3px solid var(--chalk, #f4f1ea)',
          boxShadow:
            '0 22px 48px -16px rgba(0,0,0,0.55), 0 0 0 1px rgba(42,32,26,0.10)',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/hair-previews/${slug}.png`}
          alt=""
          onError={() => setErrored(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
    </div>,
    document.body,
  );
}
