'use client';

import { useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { useSignIn, useSignUp } from '@clerk/nextjs/legacy';
import Link from 'next/link';
import { BouncyButton } from '@/components/AppUI';

export interface SignUpWidgetProps {
  onEnter: () => void;
  large?: boolean;
  onBeforeGoogleRedirect?: () => void;
  redirectUrlComplete?: string;
}

export default function SignUpWidget({ onEnter, large = false, onBeforeGoogleRedirect, redirectUrlComplete = '/' }: SignUpWidgetProps) {
  const { signUp, setActive } = useSignUp();
  const { signIn } = useSignIn();
  const { isSignedIn } = useUser();
  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'start' | 'password' | 'verify' | '2fa'>('start');
  const [secondFactorStrategy, setSecondFactorStrategy] = useState<'email_code' | 'totp' | 'phone_code' | 'backup_code'>('email_code');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const s = {
    cardMaxWidth:     large ? 640  : 340,
    cardRadius:       large ? 28   : 20,
    cardPadding:      large ? '40px 40px 32px' : '24px 24px 20px',
    cardGap:          large ? 20   : 12,
    inputFontSize:    large ? 22   : 15,
    inputPadding:     large ? '18px 24px' : '13px 16px',
    inputRadius:      large ? 16   : 12,
    formGap:          large ? 14   : 10,
    btnFontSize:      large ? 22   : 15,
    btnPadding:       large ? '18px 0' : '13px 0',
    btnRadius:        large ? 16   : 12,
    googleFontSize:   large ? 20   : 14,
    googlePadding:    large ? '18px 0' : '12px 0',
    googleRadius:     large ? 16   : 12,
    googleGap:        large ? 14   : 10,
    googleIconSize:   large ? 24   : 18,
    orFontSize:       large ? 13   : 10,
    orGap:            large ? 14   : 10,
    noteFontSize:     large ? 13   : 10,
    errorFontSize:    large ? 16   : 12,
    backFontSize:     large ? 18   : 13,
    titleFontSize:    large ? 22   : 15,
    subtitleFontSize: large ? 18   : 13,
    codeFontSize:     large ? 32   : 20,
    dashBtnPadding:   large ? '22px 56px' : '18px 44px',
    dashBtnFontSize:  large ? 28   : 22,
    dashBtnRadius:    large ? 20   : 18,
  };

  if (isSignedIn) {
    return (
      <BouncyButton
        onClick={onEnter}
        className="btn-tomato"
        style={{
          padding: s.dashBtnPadding,
          fontSize: s.dashBtnFontSize,
          fontFamily: 'var(--font-fraunces), Georgia, serif',
          fontVariationSettings: "'SOFT' 100, 'WONK' 0, 'opsz' 144",
          fontWeight: 900,
          letterSpacing: '-0.01em',
          borderRadius: s.dashBtnRadius,
          boxShadow: '0 8px 28px -6px rgba(217,78,58,0.45)',
        }}
      >
        Go to dashboard →
      </BouncyButton>
    );
  }

  const submitCredentials = async () => {
    if (!clerkConfigured) {
      setError('Sign-in is not configured for this deployment.');
      return;
    }
    if (!signIn || !signUp || !setActive) {
      setError('Sign-in is still loading. Try again in a moment.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      let signInResult;
      try {
        signInResult = await signIn.create({ strategy: 'password', identifier: email.trim(), password });
      } catch (rawErr: unknown) {
        const err = rawErr as { errors?: Array<{ code?: string; message?: string }> };
        const firstErr = err?.errors?.[0];
        const code = firstErr?.code ?? '';
        const isNotFound = code === 'form_identifier_not_found'
          || (firstErr?.message ?? '').toLowerCase().includes('find');
        if (!isNotFound) {
          const friendlyMsg: Record<string, string> = {
            form_password_incorrect:          'Wrong password — try again.',
            form_password_pwned:              'This password was found in a data breach. Please choose a different one.',
            strategy_for_user_invalid:        'This account was created with Google. Use "Continue with Google" to sign in.',
            not_allowed_access:               'Your account has been suspended. Contact support for help.',
            too_many_requests:                'Too many attempts — please wait a moment and try again.',
            session_exists:                   'You\'re already signed in.',
            form_param_missing:               'Please enter both your email and password.',
            form_identifier_not_found:        'No account found with that email.',
          };
          setError(friendlyMsg[code] ?? (firstErr?.message ?? 'Something went wrong'));
          return;
        }
        signInResult = null;
      }

      if (signInResult) {
        let finalResult = signInResult;
        if (signInResult.status === 'needs_first_factor') {
          finalResult = await signIn.attemptFirstFactor({ strategy: 'password', password });
        }
        if (finalResult.status === 'complete' && finalResult.createdSessionId) {
          await setActive({ session: finalResult.createdSessionId });
          onEnter();
          return;
        }
        if (finalResult.status === 'needs_second_factor') {
          const supported = finalResult.supportedSecondFactors ?? [];
          const strategy =
            supported.find((f: { strategy: string }) => f.strategy === 'email_code') ? 'email_code' :
            supported.find((f: { strategy: string }) => f.strategy === 'phone_code') ? 'phone_code' :
            supported.find((f: { strategy: string }) => f.strategy === 'totp') ? 'totp' :
            'email_code';
          setSecondFactorStrategy(strategy as 'email_code' | 'totp' | 'phone_code' | 'backup_code');
          if (strategy === 'email_code' || strategy === 'phone_code') {
            await signIn.prepareSecondFactor({ strategy });
          }
          setCode('');
          setStep('2fa');
          return;
        }
        setError('Sign-in incomplete — please try again.');
        return;
      }

      const signUpResult = await signUp.create({ emailAddress: email.trim(), password });
      if (signUpResult.status === 'missing_requirements') {
        await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
        setStep('verify');
      } else if (signUpResult.status === 'complete' && signUpResult.createdSessionId) {
        await setActive({ session: signUpResult.createdSessionId });
        onEnter();
      } else {
        setError('Sign-up failed — please try again.');
      }
    } catch (err: unknown) {
      const e = err as { errors?: Array<{ code?: string; message?: string }> };
      const clerkCode = e?.errors?.[0]?.code ?? '';
      const outerFriendly: Record<string, string> = {
        form_password_not_strong_enough: 'Password is too weak — use at least 8 characters with a mix of letters and numbers.',
        form_identifier_exists:          'An account with this email already exists. Try signing in instead.',
        strategy_for_user_invalid:       'This account was created with Google. Use "Continue with Google" to sign in.',
        not_allowed_access:              'Your account has been suspended. Contact support for help.',
        too_many_requests:               'Too many attempts — please wait a moment and try again.',
      };
      setError(outerFriendly[clerkCode] ?? (e?.errors?.[0]?.message ?? (err instanceof Error ? err.message : 'Something went wrong')));
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setError('');
    setStep('password');
  };

  const handlePassword = async (e: React.FormEvent) => { e.preventDefault(); if (!password) return; await submitCredentials(); };

  const handleSubmit = async (e: React.FormEvent) => { e.preventDefault(); if (!email.trim() || !password) return; await submitCredentials(); };

  const handleVerify = async (e: React.FormEvent) => {
    if (!signUp || !setActive) return;
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const result = await signUp.attemptEmailAddressVerification({ code });
      if (result.status === 'complete' && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        onEnter();
      } else {
        setError('Sign-up failed — please try again.');
      }
    } catch (err: unknown) {
      const e = err as { errors?: Array<{ message?: string }> };
      setError(e?.errors?.[0]?.message ?? (err instanceof Error ? err.message : 'Invalid code — try again'));
    } finally {
      setSubmitting(false);
    }
  };

  const handle2FA = async (e: React.FormEvent) => {
    if (!signIn || !setActive) return;
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const result = await signIn.attemptSecondFactor({ strategy: secondFactorStrategy, code });
      if (result.status === 'complete' && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        onEnter();
      } else {
        setError('Verification failed — please try again.');
      }
    } catch (err: unknown) {
      const e = err as { errors?: Array<{ message?: string }> };
      setError(e?.errors?.[0]?.message ?? (err instanceof Error ? err.message : 'Invalid code — try again'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    if (!clerkConfigured) {
      setError('Sign-in is not configured for this deployment.');
      return;
    }
    if (!signIn) {
      setError('Sign-in is still loading. Try again in a moment.');
      return;
    }
    setError('');
    try {
      onBeforeGoogleRedirect?.();
      await signIn.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl: '/sso-callback',
        redirectUrlComplete,
      });
    } catch (err: unknown) {
      const e = err as { errors?: Array<{ message?: string }> };
      setError(e?.errors?.[0]?.message ?? (err instanceof Error ? err.message : 'Google sign-in failed'));
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    fontFamily: 'var(--font-dmsans)',
    fontSize: s.inputFontSize,
    padding: s.inputPadding,
    borderRadius: s.inputRadius,
    border: '1.5px solid rgba(42,32,26,0.13)',
    background: 'var(--biscuit)',
    color: 'var(--ink)',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 180ms ease',
  };

  const GoogleIcon = () => (
    <svg width={s.googleIconSize} height={s.googleIconSize} viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
      <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
    </svg>
  );

  return (
    <div style={{
      width: '100%',
      maxWidth: s.cardMaxWidth,
      background: 'var(--cream)',
      border: '1px solid rgba(42,32,26,0.1)',
      borderRadius: s.cardRadius,
      padding: s.cardPadding,
      boxShadow: '0 10px 44px -12px rgba(42,32,26,0.16)',
      display: 'flex',
      flexDirection: 'column',
      gap: s.cardGap,
    }}>
      {/* ── Verify email code ── */}
      {step === 'verify' && (
        <>
          <button
            onClick={() => { setStep(large ? 'start' : 'password'); setCode(''); setError(''); }}
            className="font-sans text-[var(--smoke)] hover:text-[var(--ink)] transition-colors text-left"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: s.backFontSize, marginBottom: 2 }}
          >
            ← back
          </button>
          <div style={{ marginBottom: 4 }}>
            <p className="font-sans" style={{ fontWeight: 600, fontSize: s.titleFontSize, color: 'var(--ink)', margin: '0 0 4px' }}>Check your inbox</p>
            <p className="font-sans" style={{ fontSize: s.subtitleFontSize, color: 'var(--smoke)', margin: 0 }}>We sent a 6-digit code to {email}</p>
          </div>
          <form onSubmit={handleVerify} style={{ display: 'flex', flexDirection: 'column', gap: s.formGap }}>
            <input
              autoFocus type="text" inputMode="numeric" maxLength={6}
              value={code}
              onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setError(''); }}
              placeholder="123456"
              style={{ ...inputStyle, letterSpacing: '0.25em', fontSize: s.codeFontSize, textAlign: 'center' }}
            />
            {error && <p className="font-sans" style={{ fontSize: s.errorFontSize, color: 'var(--tomato)', margin: 0 }}>{error}</p>}
            <button type="submit" disabled={submitting || code.length < 6} className="btn-tomato"
              style={{ ...inputStyle, padding: s.btnPadding, background: undefined, border: 'none', fontFamily: 'var(--font-dmsans)', fontWeight: 700, fontSize: s.btnFontSize, opacity: submitting || code.length < 6 ? 0.5 : 1, cursor: submitting || code.length < 6 ? 'not-allowed' : 'pointer', transition: 'opacity 150ms ease', color: 'var(--cream)' }}>
              {submitting ? 'Verifying…' : 'Verify →'}
            </button>
          </form>
        </>
      )}

      {/* ── Two-factor auth ── */}
      {step === '2fa' && (
        <>
          <button
            onClick={() => { setStep(large ? 'start' : 'password'); setCode(''); setError(''); }}
            className="font-sans text-[var(--smoke)] hover:text-[var(--ink)] transition-colors text-left"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: s.backFontSize, marginBottom: 2 }}
          >
            ← back
          </button>
          <div style={{ marginBottom: 4 }}>
            <p className="font-sans" style={{ fontWeight: 600, fontSize: s.titleFontSize, color: 'var(--ink)', margin: '0 0 4px' }}>Two-factor authentication</p>
            <p className="font-sans" style={{ fontSize: s.subtitleFontSize, color: 'var(--smoke)', margin: 0 }}>
              {secondFactorStrategy === 'phone_code' ? `Enter the code sent to your phone` : `Enter the code sent to ${email}`}
            </p>
          </div>
          <form onSubmit={handle2FA} style={{ display: 'flex', flexDirection: 'column', gap: s.formGap }}>
            <input
              autoFocus type="text" inputMode="numeric" maxLength={secondFactorStrategy === 'backup_code' ? 20 : 6}
              value={code}
              onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setError(''); }}
              placeholder="123456"
              style={{ ...inputStyle, letterSpacing: '0.25em', fontSize: s.codeFontSize, textAlign: 'center' }}
            />
            {error && <p className="font-sans" style={{ fontSize: s.errorFontSize, color: 'var(--tomato)', margin: 0 }}>{error}</p>}
            <button type="submit" disabled={submitting || code.length < 6} className="btn-tomato"
              style={{ ...inputStyle, padding: s.btnPadding, background: undefined, border: 'none', fontFamily: 'var(--font-dmsans)', fontWeight: 700, fontSize: s.btnFontSize, opacity: submitting || code.length < 6 ? 0.5 : 1, cursor: submitting || code.length < 6 ? 'not-allowed' : 'pointer', transition: 'opacity 150ms ease', color: 'var(--cream)' }}>
              {submitting ? 'Verifying…' : 'Verify →'}
            </button>
          </form>
        </>
      )}

      {/* ── Landing page: password step ── */}
      {!large && step === 'password' && (
        <>
          <button
            onClick={() => { setStep('start'); setPassword(''); setError(''); }}
            className="font-sans text-[var(--smoke)] hover:text-[var(--ink)] transition-colors text-left"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: s.backFontSize, marginBottom: 2 }}
          >
            ← back
          </button>
          <p className="font-sans" style={{ fontSize: s.subtitleFontSize, color: 'var(--smoke)', margin: 0 }}>{email}</p>
          <form onSubmit={handlePassword} style={{ display: 'flex', flexDirection: 'column', gap: s.formGap }}>
            <input
              autoFocus type="password" autoComplete="new-password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              placeholder="password"
              style={inputStyle}
              onFocus={e => (e.target.style.borderColor = 'rgba(217,78,58,0.5)')}
              onBlur={e => (e.target.style.borderColor = 'rgba(42,32,26,0.13)')}
            />
            {error && <p className="font-sans" style={{ fontSize: s.errorFontSize, color: 'var(--tomato)', margin: 0 }}>{error}</p>}
            <button type="submit" disabled={submitting || !password} className="btn-tomato"
              style={{ padding: s.btnPadding, borderRadius: s.btnRadius, fontSize: s.btnFontSize, fontFamily: 'var(--font-dmsans)', fontWeight: 700, border: 'none', opacity: submitting || !password ? 0.5 : 1, cursor: submitting || !password ? 'not-allowed' : 'pointer', transition: 'opacity 150ms ease' }}>
              {submitting ? 'One sec…' : 'Continue →'}
            </button>
          </form>
        </>
      )}

      {/* ── Start step ── */}
      {step === 'start' && (
        <>
          {large ? (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: s.formGap }}>
              <input
                autoFocus type="email" autoComplete="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(''); }}
                placeholder="your@email.com"
                style={inputStyle}
                onFocus={e => (e.target.style.borderColor = 'rgba(217,78,58,0.5)')}
                onBlur={e => (e.target.style.borderColor = 'rgba(42,32,26,0.13)')}
              />
              <input
                type="password" autoComplete="current-password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                placeholder="password"
                style={inputStyle}
                onFocus={e => (e.target.style.borderColor = 'rgba(217,78,58,0.5)')}
                onBlur={e => (e.target.style.borderColor = 'rgba(42,32,26,0.13)')}
              />
              {error && <p className="font-sans" style={{ fontSize: s.errorFontSize, color: 'var(--tomato)', margin: 0 }}>{error}</p>}
              <button type="submit" disabled={submitting || !email.trim() || !password} className="btn-tomato"
                style={{ padding: s.btnPadding, borderRadius: s.btnRadius, fontSize: s.btnFontSize, fontFamily: 'var(--font-dmsans)', fontWeight: 700, border: 'none', opacity: submitting || !email.trim() || !password ? 0.5 : 1, cursor: submitting || !email.trim() || !password ? 'not-allowed' : 'pointer', transition: 'opacity 150ms ease' }}>
                {submitting ? 'One sec…' : 'Continue →'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleEmail} style={{ display: 'flex', flexDirection: 'column', gap: s.formGap }}>
              <input
                type="email" autoComplete="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(''); }}
                placeholder="your@email.com"
                style={inputStyle}
                onFocus={e => (e.target.style.borderColor = 'rgba(217,78,58,0.5)')}
                onBlur={e => (e.target.style.borderColor = 'rgba(42,32,26,0.13)')}
              />
              {error && <p className="font-sans" style={{ fontSize: s.errorFontSize, color: 'var(--tomato)', margin: 0 }}>{error}</p>}
              <button type="submit" disabled={!email.trim()} className="btn-tomato"
                style={{ padding: s.btnPadding, borderRadius: s.btnRadius, fontSize: s.btnFontSize, fontFamily: 'var(--font-dmsans)', fontWeight: 700, border: 'none', opacity: !email.trim() ? 0.5 : 1, cursor: !email.trim() ? 'not-allowed' : 'pointer', transition: 'opacity 150ms ease' }}>
                Continue with email →
              </button>
            </form>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: s.orGap }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(42,32,26,0.1)' }} />
            <span className="font-mono" style={{ fontSize: s.orFontSize, color: 'var(--smoke)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>or</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(42,32,26,0.1)' }} />
          </div>

          <button
            onClick={handleGoogle}
            className="font-sans"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: s.googleGap,
              width: '100%', padding: s.googlePadding, borderRadius: s.googleRadius,
              border: '1.5px solid rgba(42,32,26,0.13)', background: 'var(--cream)',
              color: 'var(--ink)', fontSize: s.googleFontSize, fontWeight: 600, cursor: 'pointer',
              transition: 'background 150ms ease, border-color 150ms ease',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--biscuit)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(42,32,26,0.22)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--cream)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(42,32,26,0.13)';
            }}
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <p className="font-mono" style={{ fontSize: s.noteFontSize, color: 'rgba(42,32,26,0.38)', textAlign: 'center', margin: 0, letterSpacing: '0.06em' }}>
            Free to start · No credit card · By continuing, you agree to the{' '}
            <Link href="/terms" style={{ color: 'inherit', textDecoration: 'underline' }}>Terms</Link>
            {' '}and{' '}
            <Link href="/privacy" style={{ color: 'inherit', textDecoration: 'underline' }}>Privacy Policy</Link>
          </p>
        </>
      )}
      <div id="clerk-captcha" />
    </div>
  );
}
