'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUser } from '@clerk/nextjs';
import { useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import { useT } from '@/lib/i18n';
import ConfettiBurst from '@/components/ConfettiBurst';

// Kept in sync with PHONE_BONUS_CREDITS in convex/users.ts (backend is the
// source of truth for the actual grant; this only drives copy).
const BONUS = 5;
const DISMISS_KEY = 'shapeup_phone_bonus_dismissed_v1';

type Step = 'phone' | 'code' | 'done';

/** Pull the most human-readable message out of a Clerk API error. */
function clerkError(err: unknown, fallback: string): string {
  const e = err as { errors?: Array<{ longMessage?: string; message?: string }>; message?: string };
  return e?.errors?.[0]?.longMessage ?? e?.errors?.[0]?.message ?? e?.message ?? fallback;
}

/**
 * Growth surface: a thin, dismissible top ribbon inviting signed-in users to
 * attach a verified phone for +BONUS free generations. Tapping it opens a
 * secure Clerk SMS-OTP flow (we never see the code); on success the server
 * re-verifies against Clerk's backend before crediting. Auto-hides once the
 * bonus is claimed (getMe.phoneBonusGrantedAt) or the user dismisses it.
 */
export default function PhoneBonusBanner() {
  const t = useT();
  const { user: clerkUser, isSignedIn, isLoaded } = useUser();
  const me = useQuery(api.users.getMe);

  const [dismissed, setDismissed] = useState(true); // assume dismissed until we read localStorage (avoids flash)
  const [mounted, setMounted] = useState(false);
  const [ribbonIn, setRibbonIn] = useState(false);
  const [open, setOpen] = useState(false);
  const [modalIn, setModalIn] = useState(false);

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confettiKey, setConfettiKey] = useState(0);

  const phoneResourceRef = useRef<Awaited<ReturnType<NonNullable<typeof clerkUser>['createPhoneNumber']>> | null>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  const alreadyClaimed = me?.phoneBonusGrantedAt != null;
  const eligible = Boolean(isLoaded && isSignedIn && me && !alreadyClaimed && !dismissed);

  // Slide the ribbon in a beat after it becomes eligible.
  useEffect(() => {
    if (!eligible) { setRibbonIn(false); return; }
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setRibbonIn(true)));
    return () => cancelAnimationFrame(id);
  }, [eligible]);

  const dismiss = () => {
    setRibbonIn(false);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode — best-effort */ }
    setTimeout(() => setDismissed(true), 260);
  };

  const openModal = () => {
    setError('');
    setCode('');
    // If a verified phone is already on the account, skip straight to claiming.
    const hasVerified = clerkUser?.phoneNumbers.some((p) => p.verification?.status === 'verified');
    setStep(hasVerified ? 'code' : 'phone');
    setOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setModalIn(true)));
    if (hasVerified) void claimBonus();
  };

  const closeModal = () => {
    setModalIn(false);
    setTimeout(() => { setOpen(false); setStep('phone'); setBusy(false); }, 280);
  };

  async function sendCode() {
    if (!clerkUser || busy) return;
    const value = phone.trim();
    if (!/^\+?[0-9][0-9\s\-().]{6,}$/.test(value)) {
      setError(t('Enter a valid phone number, including country code.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const resource = await clerkUser.createPhoneNumber({ phoneNumber: value });
      phoneResourceRef.current = resource;
      await resource.prepareVerification();
      setStep('code');
      setTimeout(() => codeInputRef.current?.focus(), 60);
    } catch (err) {
      setError(clerkError(err, t("Couldn't send the code. Check the number and try again.")));
    } finally {
      setBusy(false);
    }
  }

  async function verifyAndClaim() {
    if (busy) return;
    if (!/^[0-9]{4,8}$/.test(code.trim())) {
      setError(t('Enter the code we texted you.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Verify the newly-added number if we have its resource in hand; if we
      // skipped straight to claim (phone already verified), there's nothing to do.
      const resource =
        phoneResourceRef.current ??
        clerkUser?.phoneNumbers.find((p) => p.verification?.status !== 'verified') ??
        null;
      if (resource && resource.verification?.status !== 'verified') {
        await resource.attemptVerification({ code: code.trim() });
      }
      await claimBonus();
    } catch (err) {
      setError(clerkError(err, t('That code was incorrect or expired. Try again.')));
      setBusy(false);
    }
  }

  async function claimBonus() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/phone-bonus/claim', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? t("Couldn't grant your bonus. Please try again."));
        setBusy(false);
        return;
      }
      setStep('done');
      setBusy(false);
      // Celebrate — respect reduced-motion.
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (!reduce) requestAnimationFrame(() => setConfettiKey((k) => k + 1));
      // getMe flips phoneBonusGrantedAt reactively → the ribbon disappears; give
      // the user a moment to enjoy the confirmation, then close.
      setTimeout(() => closeModal(), 2600);
    } catch {
      setError(t("Couldn't reach the server. Please try again."));
      setBusy(false);
    }
  }

  const shown = modalIn && open;

  const ribbon = useMemo(() => {
    if (!eligible) return null;
    return (
      <div
        role="region"
        aria-label={t('Free generations offer')}
        className="phone-bonus-ribbon"
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9990,
          transform: ribbonIn ? 'translateY(0)' : 'translateY(-100%)',
          transition: 'transform 320ms cubic-bezier(.2,.85,.2,1)',
        }}
      >
        <div className="phone-bonus-ribbon__inner">
          <span className="phone-bonus-ribbon__badge" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="7" y="2" width="10" height="20" rx="2.5" />
              <path d="M11 18h2" />
            </svg>
          </span>
          <p className="phone-bonus-ribbon__text">
            {t('Add your phone number and get')}{' '}
            <strong>{t('{n} free generations', { n: BONUS })}</strong>
            <span className="phone-bonus-ribbon__sub"> · {t('one tap, fully secure')}</span>
          </p>
          <button type="button" onClick={openModal} className="phone-bonus-ribbon__cta">
            {t('Claim +{n}', { n: BONUS })}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="phone-bonus-ribbon__x"
            aria-label={t('Dismiss offer')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, ribbonIn, t]);

  if (!mounted) return null;

  return (
    <>
      {ribbon}
      {open && createPortal(
        <div
          className="fixed inset-0 z-[10050] flex items-center justify-center"
          style={{
            background: shown ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0)',
            transition: 'background 300ms ease',
            padding: 20,
          }}
          onClick={() => { if (step !== 'done') closeModal(); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="phone-bonus-title"
            onClick={(e) => e.stopPropagation()}
            className="relative flex flex-col rounded-3xl"
            style={{
              background: 'var(--cream)',
              border: '1px solid rgba(42,32,26,0.1)',
              boxShadow: '0 32px 90px -16px rgba(0,0,0,0.5)',
              padding: '32px 32px 28px',
              maxWidth: 420,
              width: 'calc(100vw - 40px)',
              opacity: shown ? 1 : 0,
              transform: shown ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.98)',
              transition: 'opacity 300ms ease, transform 340ms cubic-bezier(.2,.85,.2,1)',
            }}
          >
            {/* Close (hidden on the celebration step) */}
            {step !== 'done' && (
              <button
                type="button"
                onClick={closeModal}
                aria-label={t('Close')}
                className="absolute top-4 right-4 flex items-center justify-center rounded-full"
                style={{ width: 34, height: 34, background: 'var(--biscuit)', border: '1px solid rgba(42,32,26,0.1)', color: 'var(--char)', cursor: 'pointer' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}

            {/* Header */}
            <div className="flex flex-col gap-2" style={{ marginBottom: 20 }}>
              <span className="phone-bonus-modal__badge" aria-hidden>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="7" y="2" width="10" height="20" rx="2.5" />
                  <path d="M11 18h2" />
                </svg>
              </span>
              <h2
                id="phone-bonus-title"
                className="font-sans text-[var(--ink)]"
                style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontSize: 24, fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.01em', marginTop: 8 }}
              >
                {step === 'done'
                  ? t('+{n} generations added!', { n: BONUS })
                  : t('Get {n} free generations', { n: BONUS })}
              </h2>
              {step !== 'done' && (
                <p className="font-sans text-[14px] text-[var(--char)] leading-relaxed">
                  {step === 'phone'
                    ? t('Verify your phone number and we’ll drop {n} generations into your account. We only use it to keep the bonus fair — no spam, ever.', { n: BONUS })
                    : t('Enter the 6-digit code we just texted you.')}
                </p>
              )}
            </div>

            {/* Body */}
            {step === 'phone' && (
              <div className="flex flex-col gap-2">
                <label htmlFor="phone-bonus-phone" className="phone-bonus-label">{t('Phone number')}</label>
                <input
                  id="phone-bonus-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+1 555 123 4567"
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); setError(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') sendCode(); }}
                  className="phone-bonus-input"
                  disabled={busy}
                  autoFocus
                />
                <span className="font-sans text-[12px] text-[var(--caramel)]">{t('Include your country code, e.g. +1.')}</span>
              </div>
            )}

            {step === 'code' && (
              <div className="flex flex-col gap-2">
                <label htmlFor="phone-bonus-code" className="phone-bonus-label">{t('Verification code')}</label>
                <input
                  id="phone-bonus-code"
                  ref={codeInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="••••••"
                  maxLength={8}
                  value={code}
                  onChange={(e) => { setCode(e.target.value.replace(/[^0-9]/g, '')); setError(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') verifyAndClaim(); }}
                  className="phone-bonus-input phone-bonus-input--code"
                  disabled={busy}
                />
              </div>
            )}

            {step === 'done' && (
              <div ref={doneRef} className="flex flex-col items-center gap-3" style={{ padding: '6px 0 8px' }}>
                <div
                  className="flex items-center justify-center rounded-full phone-bonus-check"
                  style={{ width: 64, height: 64 }}
                  aria-hidden
                >
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </div>
                <p className="font-sans text-[14px] text-[var(--char)] text-center leading-relaxed">
                  {t('They’re in your balance now. Go try a new look!')}
                </p>
              </div>
            )}

            {/* Error */}
            {error && (
              <p role="alert" className="font-sans text-[13px] leading-snug" style={{ color: 'var(--tomato)', marginTop: 12 }}>
                {error}
              </p>
            )}

            {/* Actions */}
            {step === 'phone' && (
              <button
                type="button"
                onClick={sendCode}
                disabled={busy}
                className="phone-bonus-primary"
                style={{ marginTop: 20 }}
              >
                {busy ? t('Sending…') : t('Text me a code')}
              </button>
            )}
            {step === 'code' && (
              <div className="flex flex-col gap-2" style={{ marginTop: 20 }}>
                <button type="button" onClick={verifyAndClaim} disabled={busy} className="phone-bonus-primary">
                  {busy ? t('Verifying…') : t('Verify & claim +{n}', { n: BONUS })}
                </button>
                <button
                  type="button"
                  onClick={() => { setStep('phone'); setCode(''); setError(''); }}
                  disabled={busy}
                  className="font-sans text-[13px] text-[var(--caramel)] py-1"
                  style={{ background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer' }}
                >
                  {t('Use a different number')}
                </button>
              </div>
            )}
          </div>
          <ConfettiBurst fireKey={confettiKey} originRef={doneRef} />
        </div>,
        document.body,
      )}
    </>
  );
}
