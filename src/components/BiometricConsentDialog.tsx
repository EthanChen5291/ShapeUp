'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';

export interface BiometricConsentDialogProps {
  onAccept: () => void;
  onCancel: () => void;
}

export default function BiometricConsentDialog({ onAccept, onCancel }: BiometricConsentDialogProps) {
  const [accepting, setAccepting] = useState(false);

  const handleAccept = async () => {
    setAccepting(true);
    await onAccept();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)' }}
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
          animation: 'popup-in 280ms cubic-bezier(.2,.85,.2,1)',
        }}
      >
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--smoke)]">Before we continue</span>
          <h2 className="font-display italic text-[var(--ink)]" style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.15 }}>
            We&rsquo;ll scan your face in&nbsp;3D
          </h2>
        </div>

        <p className="font-sans text-[14px] text-[var(--char)] leading-relaxed">
          The 3D head reconstruction processes biometric data derived from your photo — specifically, facial geometry used only to render your virtual haircut preview. This data is not sold or shared with third parties.
        </p>

        <ul className="font-sans text-[13px] text-[var(--smoke)] leading-relaxed list-none flex flex-col gap-1.5">
          <li>✓ Used solely for your haircut preview</li>
          <li>✓ Stored in your account; delete anytime</li>
          <li>✓ Not used to train models or identify you</li>
        </ul>

        <p className="font-mono text-[10px] text-[var(--smoke)]">
          By tapping &ldquo;I agree&rdquo; you consent to this processing under our{' '}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline">
            Privacy Policy
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
            Cancel
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
            {accepting ? 'Saving…' : 'I agree'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
