'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface RefundRequestDialogProps {
  projectId: string;
  onClose: () => void;
}

type Stage = 'intro' | 'form' | 'done';

/**
 * Shown in the studio to remind users that if a generated model isn't right
 * (face drift, wrong proportions, etc.) they can request a token refund. The
 * request fans out to Discord with their selfie + splat so we can verify it, and
 * shows up in the /admin/refunds queue. Styled to match ImproveShapeUpDialog.
 */
export default function RefundRequestDialog({ projectId, onClose }: RefundRequestDialogProps) {
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
      onClick={close}
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
        {stage === 'intro' && (
          <>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--smoke)]">
                Not quite right?
              </span>
              <h2 className="font-display italic text-[var(--ink)]" style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.15 }}>
                We&rsquo;ll make it right
              </h2>
            </div>

            <p className="font-sans text-[14px] text-[var(--char)] leading-relaxed">
              Unhappy with your model? Request a refund and we&rsquo;ll take a look.
            </p>

            <ul className="font-sans text-[13px] text-[var(--smoke)] leading-relaxed list-none flex flex-col gap-1.5">
              <li>✓ We review your selfie and 3D model ourselves</li>
              <li>✓ Approved refunds return your token, no questions asked</li>
            </ul>

            <div className="flex gap-3 pt-1">
              <button
                onClick={close}
                className="flex-1 font-sans text-[14px] font-semibold rounded-xl py-3 transition-colors"
                style={{
                  background: 'var(--biscuit)',
                  border: '1.5px solid rgba(42,32,26,0.12)',
                  color: 'var(--smoke)',
                  cursor: 'pointer',
                }}
              >
                Looks good
              </button>
              <button
                onClick={() => setStage('form')}
                className="flex-1 font-sans text-[14px] font-semibold rounded-xl py-3 transition-colors"
                style={{ background: 'var(--ink)', color: 'var(--cream)', border: 'none', cursor: 'pointer' }}
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
