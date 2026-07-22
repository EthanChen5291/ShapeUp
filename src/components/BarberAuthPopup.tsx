'use client';

import { useEffect, useRef } from 'react';
import SignUpWidget from '@/components/SignUpWidget';
import { useT } from '@/lib/i18n';

export interface BarberAuthPopupProps {
  open: boolean;
  onClose: () => void;
  onAuthenticated: () => void;
}

function CloseIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

/** Shared, card-level sign-in gate for the two entry choices. */
export default function BarberAuthPopup({
  open,
  onClose,
  onAuthenticated,
}: BarberAuthPopupProps) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const redirectUrlComplete = typeof window === 'undefined'
    ? '/'
    : `${window.location.pathname}${window.location.search}`;

  return (
    <div
      className="bc-auth-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="bc-auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="barber-auth-title"
      >
        <button
          ref={closeRef}
          className="bc-auth-close"
          type="button"
          onClick={onClose}
          aria-label={t('Close sign-in')}
        >
          <CloseIcon />
        </button>
        <div className="bc-auth-heading">
          <p className="bc-book-eyebrow font-mono">{t('Save your place')}</p>
          <h2 id="barber-auth-title">{t('One quick sign-in to continue.')}</h2>
          <p className="font-sans">
            {t('Your preview stays private and your choice stays connected to this barber.')}
          </p>
        </div>
        <SignUpWidget
          onEnter={onAuthenticated}
          redirectUrlComplete={redirectUrlComplete}
        />
      </div>
    </div>
  );
}
