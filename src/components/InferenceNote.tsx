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

const PRESETS: Record<Exclude<Variant, 'inline'>, ReactNode> = {
  scan: <>We infer shape, hairline, and proportions from your photos — expect a great likeness, not a measurement.</>,
  model: <>✨ Built from your photos — some details are our best guess.</>,
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
          background: 'rgba(20,16,12,0.55)',
          backdropFilter: 'blur(6px)',
          color: 'rgba(255,248,234,0.82)',
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
