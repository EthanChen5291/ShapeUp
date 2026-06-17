'use client';

// ============================================================
// InferenceNote — quiet, on-brand "this is inferred" disclaimer
// ============================================================
// Lives next to inferred output (the 3D model, the loader, edit results).
// Never modal. Confident, not apologetic — inference is the feature, so
// every "not exact" is paired with what to do about it. Copy presets keep
// wording consistent across surfaces.

import { ReactNode } from 'react';

type Variant = 'scan' | 'model' | 'edit' | 'inline';

const PRESETS: Record<Exclude<Variant, 'inline'>, ReactNode> = {
  scan: <>We infer shape, hairline, and proportions from your photos — expect a great likeness, not a measurement.</>,
  model: <>✨ Our best read of your head — close, not exact. Tweak anything that looks off.</>,
  edit: <>AI-generated preview. Real results vary — bring it to your barber as a reference, not a blueprint.</>,
};

interface InferenceNoteProps {
  variant?: Variant;
  children?: ReactNode;
  className?: string;
  /** "badge" = compact pill for overlaying the 3D viewport; "line" = inline caption. */
  tone?: 'badge' | 'line';
}

export default function InferenceNote({ variant = 'inline', children, className = '', tone = 'line' }: InferenceNoteProps) {
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
          fontSize: 11,
          lineHeight: 1.3,
          padding: '6px 12px',
          maxWidth: 280,
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
