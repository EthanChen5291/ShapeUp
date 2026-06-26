'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface RefundRequestDialogProps {
  projectId: string;
  onClose: () => void;
  /**
   * When true the dialog is shown proactively (the new-account first-render
   * reminder) and must be acknowledged: the backdrop won't dismiss it and the
   * intro carries an emphasis icon. When false (the user opened it via the
   * "not happy?" link) it stays casually dismissible.
   */
  requireAck?: boolean;
}

type Stage = 'intro' | 'form' | 'done';

// Inline info glyph — SVG only (no emoji as icons), inherits currentColor.
function InfoIcon({ size = 20 }: { size?: number }) {
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
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.5h.01" />
    </svg>
  );
}

/**
 * Shown in the studio to remind users that if a generated model isn't right
 * (face drift, wrong proportions, etc.) they can request a token refund. The
 * request fans out to Discord with their selfie + splat so we can verify it, and
 * shows up in the /admin/refunds queue. Styled to match ImproveShapeUpDialog.
 */
export default function RefundRequestDialog({ projectId, onClose, requireAck = false }: RefundRequestDialogProps) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const [stage, setStage] = useState<Stage>('intro');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fade in on mount (two RAFs so the transition starts from the hidden state).
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    return () => cancelAnimationFrame(id);
  }, []);

  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 340); // let the fade-out play before the parent unmounts us
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/refund-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, reason: reason.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
      setStage('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
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
      // The proactive reminder must be acknowledged — only the casual,
      // user-opened variant dismisses on backdrop click.
      onClick={requireAck ? undefined : close}
    >
      <div
        className="relative flex flex-col gap-5 rounded-3xl"
        onClick={(e) => e.stopPropagation()}
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
        {/* The proactive reminder must be acknowledged — no quick close X. */}
        {!requireAck && (
          <button
            onClick={close}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--biscuit)]"
            style={{ background: 'none', border: 'none', color: 'var(--smoke)', cursor: 'pointer' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}

        {stage === 'intro' && (
          <>
            <div className="flex flex-col gap-3">
              {requireAck && (
                <span
                  className="flex items-center justify-center rounded-2xl"
                  style={{
                    width: 44,
                    height: 44,
                    background: 'color-mix(in srgb, var(--tomato) 14%, transparent)',
                    color: 'var(--tomato)',
                  }}
                >
                  <InfoIcon />
                </span>
              )}
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--smoke)]">
                  Not quite right?
                </span>
                <h2 className="font-display italic text-[var(--ink)]" style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.15 }}>
                  Unhappy with your model?
                </h2>
              </div>
            </div>

            <p className="font-sans text-[14px] text-[var(--char)] leading-relaxed">
              We&rsquo;re sorry if this one didn&rsquo;t come out right. Our technology is still
              improving, and it can sometimes produce unexpected results. If your model isn&rsquo;t
              what you hoped for, we&rsquo;ll make it right.
            </p>

            <div className="flex flex-col items-center gap-3 pt-1">
              <button
                onClick={close}
                className="w-full font-sans text-[14px] font-semibold rounded-xl py-3 transition-colors"
                style={{ background: 'var(--ink)', color: 'var(--cream)', border: 'none', cursor: 'pointer' }}
              >
                Okay
              </button>
              <button
                onClick={() => setStage('form')}
                className="font-sans text-[13px] underline underline-offset-4 transition-colors hover:text-[var(--char)]"
                style={{ background: 'none', border: 'none', color: 'var(--smoke)', cursor: 'pointer', padding: 0 }}
              >
                Request a refund
              </button>
            </div>
          </>
        )}

        {stage === 'form' && (
          <>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--smoke)]">
                Refund request
              </span>
              <h2 className="font-display italic text-[var(--ink)]" style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.15 }}>
                What went wrong?
              </h2>
            </div>

            <p className="font-sans text-[13px] text-[var(--char)] leading-relaxed">
              Tell us what&rsquo;s off (optional). We&rsquo;ll review the model attached to this project
              and refund your token if it didn&rsquo;t come out right.
            </p>

            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              placeholder="e.g. the face doesn't look like me, the hairline drifted…"
              className="input-soft w-full rounded-xl px-3 py-2.5 text-sm resize-none h-24 placeholder:text-[var(--smoke)]"
              style={{ fontStyle: 'italic', background: 'var(--biscuit-lt)', border: '1px solid rgba(42,32,26,0.12)', color: 'var(--ink)' }}
            />

            {error && (
              <p className="font-mono text-[11px] leading-tight" style={{ color: 'var(--cherry, #d94e3a)' }}>
                {error}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setStage('intro')}
                disabled={submitting}
                className="flex-1 font-sans text-[14px] font-semibold rounded-xl py-3 transition-colors"
                style={{
                  background: 'var(--biscuit)',
                  border: '1.5px solid rgba(42,32,26,0.12)',
                  color: 'var(--smoke)',
                  cursor: submitting ? 'default' : 'pointer',
                }}
              >
                Back
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="flex-1 font-sans text-[14px] font-semibold rounded-xl py-3 transition-colors"
                style={{ background: 'var(--ink)', color: 'var(--cream)', border: 'none', cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}
              >
                {submitting ? 'Sending…' : 'Submit request'}
              </button>
            </div>
          </>
        )}

        {stage === 'done' && (
          <>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--smoke)]">
                Got it
              </span>
              <h2 className="font-display italic text-[var(--ink)]" style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.15 }}>
                Request received
              </h2>
            </div>
            <p className="font-sans text-[14px] text-[var(--char)] leading-relaxed">
              Thanks — we&rsquo;ll review your model and follow up. If it didn&rsquo;t come out right,
              your token will be refunded.
            </p>
            <div className="flex pt-1">
              <button
                onClick={close}
                className="flex-1 font-sans text-[14px] font-semibold rounded-xl py-3 transition-colors"
                style={{ background: 'var(--ink)', color: 'var(--cream)', border: 'none', cursor: 'pointer' }}
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
