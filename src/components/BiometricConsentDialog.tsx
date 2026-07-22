'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/lib/i18n';

export interface BiometricConsentDialogProps {
  onAccept: () => void;
  onCancel: () => void;
}

// Small SVG check used in the reassurance list — vector, not a unicode/emoji glyph.
function CheckRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--tomato, #d94e3a)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-[2px] shrink-0"
        aria-hidden
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
      <span>{children}</span>
    </li>
  );
}

export default function BiometricConsentDialog({ onAccept, onCancel }: BiometricConsentDialogProps) {
  const t = useT();
  const [accepting, setAccepting] = useState(false);

  const handleAccept = async () => {
    setAccepting(true);
    await onAccept();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="biometric-consent-dialog relative flex flex-col gap-5 rounded-3xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="biometric-consent-title"
        style={{
          background: 'var(--cream)',
          border: '1px solid rgba(42,32,26,0.1)',
          boxShadow: '0 32px 90px -16px rgba(0,0,0,0.5)',
          padding: '40px 44px 36px',
          maxWidth: 460,
          width: 'calc(100vw - 40px)',
          animation: 'popup-in 280ms cubic-bezier(.2,.85,.2,1)',
        }}
      >
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--smoke)]">{t('Before we continue')}</span>
          <h2
            id="biometric-consent-title"
            className="font-sans text-[var(--ink)]"
            style={{ fontSize: 23, fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.01em' }}
          >
            {t('A quick note on your face data')}
          </h2>
        </div>

        <p className="font-sans text-[14px] text-[var(--char)] leading-relaxed">
          {t('Our 3D rendering processes biometric data — specifically, facial geometry used to render your haircut preview. This data is not sold or shared with third parties.')}
        </p>

        <ul className="font-sans text-[13px] text-[var(--smoke)] leading-relaxed list-none flex flex-col gap-2">
          <CheckRow>{t('Used solely for your haircut preview')}</CheckRow>
          <CheckRow>{t('Stored in your account; delete anytime')}</CheckRow>
          <CheckRow>{t('Not used to train models or identify you')}</CheckRow>
        </ul>

        <p className="font-mono text-[10px] text-[var(--smoke)]">
          {t('By tapping “I agree” you consent to this processing under our')}{' '}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline">
            {t('Privacy Policy')}
          </a>
          .
        </p>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onCancel}
            disabled={accepting}
            className="flex-1 font-sans text-[14px] font-semibold rounded-xl py-3 transition-colors"
            style={{
              background: 'var(--biscuit)',
              border: '1.5px solid rgba(42,32,26,0.12)',
              color: 'var(--smoke)',
              cursor: 'pointer',
            }}
          >
            {t('Cancel')}
          </button>
          <button
            onClick={handleAccept}
            disabled={accepting}
            className="flex-1 font-sans text-[14px] font-semibold rounded-xl py-3 transition-colors"
            style={{
              background: accepting ? 'rgba(42,32,26,0.2)' : 'var(--ink)',
              color: accepting ? 'var(--smoke)' : 'var(--cream)',
              border: 'none',
              cursor: accepting ? 'default' : 'pointer',
            }}
          >
            {accepting ? t('Saving…') : t('I agree')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
