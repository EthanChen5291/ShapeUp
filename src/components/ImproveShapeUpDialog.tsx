'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ImproveShapeUpDialogProps {
  onChoice: (optIn: boolean) => void | Promise<void>;
}

/**
 * One-time "Improve ShapeUp?" opt-in shown after a new user reaches the dashboard.
 * Fades in over a dimmed backdrop. Scoped to anonymous usage analytics only — it
 * deliberately does NOT touch scan/face data, which is governed separately by the
 * mandatory BiometricConsentDialog. Default stance is off: declining is one tap.
 */
export default function ImproveShapeUpDialog({ onChoice }: ImproveShapeUpDialogProps) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fade in on mount (two RAFs so the transition starts from the hidden state).
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    return () => cancelAnimationFrame(id);
  }, []);

  const choose = (optIn: boolean) => {
    if (saving || closing) return;
    setSaving(true);
    setClosing(true); // start the fade-out; parent keeps us mounted long enough to play it
    onChoice(optIn);
  };

  const shown = visible && !closing;

  return createPortal(
    <div
      className="fixed inset-0 z-[10040] flex items-center justify-center"
      style={{
        background: shown ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0)',
        transition: 'background 320ms ease',
        pointerEvents: shown ? 'auto' : 'none',
      }}
    >
      <div
        className="relative flex flex-col gap-5 rounded-3xl"
        style={{
          background: 'var(--cream)',
          border: '1px solid rgba(42,32,26,0.1)',
          boxShadow: '0 32px 90px -16px rgba(0,0,0,0.5)',
          padding: '40px 44px 36px',
          maxWidth: 460,
          width: 'calc(100vw - 40px)',
          opacity: shown ? 1 : 0,
          transform: shown ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.98)',
          transition: 'opacity 320ms ease, transform 360ms cubic-bezier(.2,.85,.2,1)',
        }}
      >
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--smoke)]">Optional</span>
          <h2 className="font-display italic text-[var(--ink)]" style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.15 }}>
            Help improve ShapeUp?
          </h2>
        </div>

        <p className="font-sans text-[14px] text-[var(--char)] leading-relaxed">
          Share anonymous usage data — which features you tap, where the app feels slow, and crashes — so we can make ShapeUp better. You can change this anytime in Settings.
        </p>

        <ul className="font-sans text-[13px] text-[var(--smoke)] leading-relaxed list-none flex flex-col gap-1.5">
          <li>✓ Anonymous — never tied to your identity</li>
          <li>✓ Never includes your scans, photos, or face data</li>
          <li>✓ Never sold or shared with third parties</li>
        </ul>

        <div className="flex gap-3 pt-1">
          <button
            onClick={() => choose(false)}
            disabled={saving}
            className="flex-1 font-sans text-[14px] font-semibold rounded-xl py-3 transition-colors"
            style={{
              background: 'var(--biscuit)',
              border: '1.5px solid rgba(42,32,26,0.12)',
              color: 'var(--smoke)',
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            Not now
          </button>
          <button
            onClick={() => choose(true)}
            disabled={saving}
            className="flex-1 font-sans text-[14px] font-semibold rounded-xl py-3 transition-colors"
            style={{
              background: 'var(--ink)',
              color: 'var(--cream)',
              border: 'none',
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            Okay
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
