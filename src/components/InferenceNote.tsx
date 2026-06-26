'use client';

// ============================================================
// InferenceNote — quiet, on-brand "this is inferred" disclaimer
// ============================================================
// Lives next to inferred output (the 3D model, the loader, edit results).
// Never modal. Confident, not apologetic — inference is the feature, so
// every "not exact" is paired with what to do about it. Copy presets keep
// wording consistent across surfaces.

import { ReactNode, useEffect, useState } from 'react';

type Variant = 'scan' | 'model' | 'edit' | 'inline';

// Inline sparkle that flows with the badge copy (baseline-nudged), replacing the
// ✨ emoji so the glyph renders consistently and inherits the text color.
function SparkleIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ display: 'inline-block', verticalAlign: '-1.5px', marginRight: 5, flexShrink: 0 }}
    >
      <path d="M12 3l1.8 4.9L18.7 9 13.8 10.8 12 15.7l-1.8-4.9L5.3 9l4.9-1.1z" />
      <path d="M19 14l.7 1.8L21.5 16.5l-1.8.7L19 19l-.7-1.8L16.5 16.5l1.8-.7z" />
    </svg>
  );
}

const PRESETS: Record<Exclude<Variant, 'inline'>, ReactNode> = {
  scan: <>We infer shape, hairline, and proportions from your photos — expect a great likeness, not a measurement.</>,
  model: <><SparkleIcon /> Built from your photos — some details are our best guess.</>,
  edit: <>Real results vary — bring it to your barber as a reference!</>,
};

interface InferenceNoteProps {
  variant?: Variant;
  children?: ReactNode;
  className?: string;
  /** "badge" = compact pill for overlaying the 3D viewport; "line" = inline caption. */
  tone?: 'badge' | 'line';
  /** When set (badge tone), the badge fades out after this many ms. */
  fadeAfterMs?: number;
}

export default function InferenceNote({ variant = 'inline', children, className = '', tone = 'line', fadeAfterMs }: InferenceNoteProps) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!fadeAfterMs) return;
    const t = setTimeout(() => setHidden(true), fadeAfterMs);
    return () => clearTimeout(t);
  }, [fadeAfterMs]);

  const text = children ?? (variant !== 'inline' ? PRESETS[variant] : null);
  if (!text) return null;

  if (tone === 'badge') {
    return (
      <div
        className={`pointer-events-none select-none rounded-full font-sans ${className}`}
        style={{
          background: '#ffffff',
          color: 'var(--char)',
          boxShadow: '0 10px 28px -10px rgba(0,0,0,0.5), 0 0 0 1px rgba(42,32,26,0.06)',
          fontSize: 12.7,
          lineHeight: 1.3,
          padding: '6.3px 12.6px',
          maxWidth: 392,
          opacity: hidden ? 0 : 1,
          transition: 'opacity 600ms ease',
        }}
      >
        {text}
      </div>
    );
  }

  return (
    <p
      className={`font-sans ${className}`}
      style={{ fontSize: 11.5, lineHeight: 1.4, color: 'var(--smoke)', opacity: 0.85, maxWidth: 420 }}
    >
      {text}
    </p>
  );
}
