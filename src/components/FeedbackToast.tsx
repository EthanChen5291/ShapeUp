'use client';

// ============================================================
// FeedbackToast — bottom-right "How'd that go?" star prompt
// ============================================================
// Solicited at a success moment in the studio (see useFeedbackPrompt).
// Star first; the comment box appears once a rating is picked, and low
// scores nudge toward the "something looks off" recovery path. Dismissal
// is free — it just starts the cooldown like a submission would.

import { useState, useEffect } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';

interface FeedbackToastProps {
  open: boolean;
  onClose: () => void;
  route?: string;
  projectId?: string;
  editCount?: number;
  isMobile?: boolean;
}

export default function FeedbackToast({ open, onClose, route, projectId, editCount, isMobile }: FeedbackToastProps) {
  const submitFeedback = useMutation(api.feedback.submitFeedback);
  const markPrompted = useMutation(api.feedback.markPrompted);

  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Mark the cooldown the moment we surface, so a dismissal still counts.
  useEffect(() => {
    if (open) markPrompted({}).catch(() => {});
  }, [open, markPrompted]);

  if (!open) return null;

  const active = hover || rating;
  const isLow = rating > 0 && rating <= 2;

  const handleSubmit = async () => {
    if (rating < 1) return;
    setSubmitting(true);
    try {
      await submitFeedback({
        rating,
        comment: comment.trim() || undefined,
        route,
        projectId,
        editCount,
      });
      setDone(true);
      setTimeout(onClose, 1400);
    } catch {
      // Surface nothing intrusive; let the user retry or dismiss.
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed z-50 flex flex-col gap-3 rounded-2xl"
      style={{
        background: 'var(--cream)',
        border: '1px solid rgba(42,32,26,0.1)',
        boxShadow: '0 24px 60px -16px rgba(0,0,0,0.45)',
        padding: '20px 22px',
        width: 'min(340px, calc(100vw - 32px))',
        // Desktop: anchor to the scene's top-right corner — just left of the
        // toolbox (w-80 = 20rem) with the toast's right edge sitting by the sun
        // brightness button, and lerp in leftward. Mobile keeps bottom-right.
        ...(isMobile
          ? {
              bottom: 20,
              right: 20,
              animation: 'popup-in 280ms cubic-bezier(.2,.85,.2,1)',
            }
          : {
              top: 96,
              right: 'calc(20rem + 52px)',
              animation: 'feedback-lerp-left 520ms cubic-bezier(0.22, 1, 0.36, 1) both',
            }),
      }}
      role="dialog"
      aria-label="Share feedback"
    >
      <button
        onClick={onClose}
        aria-label="Dismiss"
        className="absolute right-3 top-3 font-mono text-[13px] text-[var(--smoke)] transition-opacity hover:opacity-100"
        style={{ opacity: 0.5, cursor: 'pointer', lineHeight: 1 }}
      >
        ✕
      </button>

      {done ? (
        <div className="flex flex-col gap-1 py-2">
          <span className="font-display italic text-[var(--ink)]" style={{ fontSize: 19 }}>
            Thank you — really.
          </span>
          <span className="font-sans text-[13px] text-[var(--smoke)]">
            {isLow ? "We read every note. We'll make this sharper." : 'It means a lot.'}
          </span>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-0.5 pr-5">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--smoke)]">
              Quick one
            </span>
            <span className="font-display italic text-[var(--ink)]" style={{ fontSize: 20, lineHeight: 1.15 }}>
              How&rsquo;d that go?
            </span>
          </div>

          <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onMouseEnter={() => setHover(n)}
                onClick={() => setRating(n)}
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                className="transition-transform"
                style={{
                  fontSize: 28,
                  lineHeight: 1,
                  cursor: 'pointer',
                  color: n <= active ? 'var(--honey)' : 'rgba(42,32,26,0.18)',
                  transform: n <= hover ? 'scale(1.12)' : 'scale(1)',
                }}
              >
                ★
              </button>
            ))}
          </div>

          {rating > 0 && (
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={2000}
              placeholder={isLow ? 'What missed the mark?' : 'What worked? (optional)'}
              rows={3}
              className="w-full resize-none rounded-xl font-sans text-[13px] text-[var(--char)] outline-none"
              style={{
                background: 'var(--offwhite)',
                border: '1px solid rgba(42,32,26,0.12)',
                padding: '10px 12px',
              }}
            />
          )}

          {rating > 0 && (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="font-sans text-[14px] font-semibold rounded-xl py-2.5 transition-colors"
              style={{
                background: submitting ? 'rgba(42,32,26,0.2)' : 'var(--ink)',
                color: submitting ? 'var(--smoke)' : 'var(--cream)',
                cursor: submitting ? 'default' : 'pointer',
              }}
            >
              {submitting ? 'Sending…' : 'Send'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
