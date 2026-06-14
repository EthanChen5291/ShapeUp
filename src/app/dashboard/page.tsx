'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useClerk, useUser } from '@clerk/nextjs';
import { useQuery, useMutation } from 'convex/react';
import { ConvexError } from 'convex/values';
import { api } from '@convex/_generated/api';
import { Id } from '@convex/_generated/dataModel';
import { useRouter } from 'next/navigation';
import { HairParams, UserHeadProfile } from '@/types';
import { ensureMeasurementSnapshot } from '@/lib/hairMeasurementSnapshot';
import { buildCurrentProfilePayload } from '@/lib/llmPayload';
import BiometricConsentDialog from '@/components/BiometricConsentDialog';
import dynamic from 'next/dynamic';
import type { ChecksMap, CheckKey } from '@/components/LiveScanCamera';
import { CHECK_META, CHECK_ORDER } from '@/components/LiveScanCamera';
import { BarberMascot, InlineWordmark, BouncyButton, ClockCounter } from '@/components/AppUI';
import SignUpWidget from '@/components/SignUpWidget';
import { PricingPopup } from '@/components/PricingPopup';
import { useNavLoading } from '@/components/NavLoadingOverlay';
import { useSettings, type Theme, type RenderQuality } from '@/contexts/SettingsContext';

const ScanCamera = dynamic(() => import('@/components/LiveScanCamera'), { ssr: false });

function generateUniqueCutName(existing: { name: string }[] | undefined): string {
  const used = new Set<number>();
  for (const p of existing ?? []) {
    const m = p.name.match(/^My Cut #(\d{3})$/);
    if (m) used.add(parseInt(m[1], 10));
  }
  const available: number[] = [];
  for (let i = 100; i <= 999; i++) { if (!used.has(i)) available.push(i); }
  if (available.length === 0) return 'My Cut';
  return `My Cut #${available[Math.floor(Math.random() * available.length)]}`;
}

/* ─── Sign-in modal ─── */
function SignInModal({ onClose }: { onClose: () => void }) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const dismiss = () => {
    setClosing(true);
    setTimeout(onClose, 300);
  };

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: visible && !closing ? 'rgba(10,8,6,0.92)' : 'rgba(10,8,6,0)',
        transition: 'background 320ms ease',
      }}
      onClick={dismiss}
    >
      <button
        onClick={dismiss}
        style={{
          position: 'absolute', top: 24, right: 24,
          width: 36, height: 36, borderRadius: '50%',
          background: 'rgba(255,248,234,0.08)', border: '1px solid rgba(255,248,234,0.16)',
          color: 'rgba(255,248,234,0.55)', cursor: 'pointer', fontSize: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >✕</button>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          transform: visible && !closing ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.97)',
          opacity: visible && !closing ? 1 : 0,
          transition: 'transform 300ms cubic-bezier(.2,.85,.2,1), opacity 280ms ease',
        }}
      >
        <SignUpWidget onEnter={onClose} />
      </div>
    </div>,
    document.body
  );
}

/* ─── Profile Menu ─── */
function ProfileMenu({ onRescan, pulse = false, celebratePurchase = false }: { onRescan: () => void; pulse?: boolean; celebratePurchase?: boolean }) {
  const { user: clerkUser, isSignedIn } = useUser();
  const { signOut } = useClerk();
  const [showSignIn, setShowSignIn] = useState(false);
  const userQuery = useQuery(api.users.getMe);
  const [open, setOpen] = useState(false);
  const [swallowing, setSwallowing] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsOriginRect, setSettingsOriginRect] = useState<DOMRect | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [displayCredits, setDisplayCredits] = useState<number | null>(null);
  const [clockKey, setClockKey] = useState(0);
  const animatingRef = useRef(false);

  useEffect(() => {
    if (!pulse) return;
    setSwallowing(true);
    const t = setTimeout(() => setSwallowing(false), 700);
    return () => clearTimeout(t);
  }, [pulse]);

  useEffect(() => {
    const update = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.top, right: window.innerWidth - rect.right });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [isSignedIn]);

  const stableUserRef = useRef(userQuery);
  if (userQuery != null) stableUserRef.current = userQuery;
  const user = stableUserRef.current;

  const startCreditsRef = useRef(0);

  useEffect(() => {
    if (!celebratePurchase) return;
    const stored = sessionStorage.getItem('preCheckoutCredits');
    sessionStorage.removeItem('preCheckoutCredits');
    const start = stored !== null ? parseInt(stored, 10) : 0;
    startCreditsRef.current = start;
    setTimeout(() => setOpen(true), 300);
    animatingRef.current = true;
    // Remount ClockCounter at pre-purchase count (no animation), then count up
    setClockKey(k => k + 1);
    setDisplayCredits(start);
  }, [celebratePurchase]);

  useEffect(() => {
    if (!animatingRef.current || user?.credits == null) return;
    const start = startCreditsRef.current;
    if (user.credits <= start) return; // webhook not yet applied, wait
    animatingRef.current = false;
    const target = user.credits;
    const duration = 1400;
    const steps = 48;
    let step = 0;
    const interval = setInterval(() => {
      step++;
      const eased = 1 - Math.pow(1 - step / steps, 3);
      setDisplayCredits(Math.round(start + eased * (target - start)));
      if (step >= steps) {
        clearInterval(interval);
        setDisplayCredits(target);
        setTimeout(() => { setOpen(false); setDisplayCredits(null); }, 1800);
      }
    }, duration / steps);
    return () => clearInterval(interval);
  }, [celebratePurchase, user?.credits]);

  if (!isSignedIn) {
    return (
      <>
        <BouncyButton onClick={() => setShowSignIn(true)} className="btn" style={{ padding: '9px 18px', fontSize: 11, background: 'var(--coral)', color: 'var(--offwhite)', border: 'none' }}>
          Sign in
        </BouncyButton>
        {showSignIn && <SignInModal onClose={() => setShowSignIn(false)} />}
      </>
    );
  }

  const username = user?.username ?? clerkUser?.firstName ?? clerkUser?.emailAddresses?.[0]?.emailAddress?.split('@')[0] ?? 'You';
  const initial = username.charAt(0).toUpperCase();

  const handleToggle = () => {
    if (!open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.top, right: window.innerWidth - rect.right });
    }
    setOpen(o => !o);
  };

  return (
    <div
      id="profile-menu-pill"
      ref={containerRef}
      className={`relative ${swallowing ? 'profile-pill-swallow' : ''}`}
      style={{ width: 251, height: 43, flexShrink: 0 }}
    >
      {menuPos && createPortal(
        <div style={{
          position: 'fixed', top: menuPos.top, right: menuPos.right,
          width: open ? 380 : 251, maxHeight: open ? '600px' : '43px',
          background: 'var(--cream)', border: '1px solid rgba(42,32,26,0.12)',
          backdropFilter: 'blur(8px)', borderRadius: open ? 22 : 40,
          boxShadow: open ? '0 20px 60px -12px rgba(0,0,0,0.28)' : 'none',
          overflow: 'hidden', zIndex: showPricing ? 10 : 9999,
          pointerEvents: showPricing ? 'none' : 'auto',
          transition: 'width 340ms cubic-bezier(.08,.82,.17,1), max-height 340ms cubic-bezier(.08,.82,.17,1), border-radius 340ms cubic-bezier(.08,.82,.17,1), box-shadow 300ms ease',
        }}>
          <button onClick={handleToggle} className="flex items-center gap-2 w-full" style={{ cursor: 'pointer', background: 'none', border: 'none', paddingLeft: 8, paddingRight: 15, height: 43 }}>
            <span className="avatar-initial">{initial}</span>
            <span className="font-sans text-[15px] flex-1 text-left" style={{ fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{username}</span>
            <span className="pill-credits">✦ <ClockCounter key={clockKey} value={displayCredits !== null ? displayCredits : (user?.credits ?? 0)} /></span>
            <svg width="12" height="12" viewBox="0 0 10 10" fill="none" style={{ color: 'var(--ink)', opacity: 0.7, transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 280ms ease', flexShrink: 0 }}>
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: open ? 'opacity 200ms 160ms ease' : 'opacity 100ms ease' }}>
            <div className="flex flex-col gap-5" style={{ padding: '8px 22px 24px' }}>
              <div className="border-t border-dashed border-[var(--char)]/15 pt-5 flex flex-col gap-3">
                <div className="tokens-widget">
                  <div className="tokens-widget__row">
                    <span className="tokens-widget__label">Tokens</span>
                    <span className="tokens-widget__count"><ClockCounter key={clockKey} value={displayCredits !== null ? displayCredits : (user?.credits ?? 0)} /></span>
                  </div>
                  <BouncyButton onClick={() => { setShowPricing(true); setOpen(false); }} className="btn-tokens-cta w-full">
                    <span className="btn-tokens-cta__shimmer" />
                    <span className="btn-tokens-cta__text">Get more tokens</span>
                  </BouncyButton>
                </div>
              </div>
              <div className="border-t border-dashed border-[var(--char)]/15 pt-3 flex items-center justify-between">
                <BouncyButton
                  onClick={() => {
                    if (containerRef.current) setSettingsOriginRect(containerRef.current.getBoundingClientRect());
                    setShowSettings(true);
                  }}
                  className="font-sans text-[var(--smoke)] hover:text-[var(--ink)] transition-colors"
                  style={{ background: 'none', border: 'none', padding: '4px 2px', lineHeight: 1 }}
                >
                  <span style={{ fontSize: 32, display: 'block', lineHeight: 1 }}>⚙</span>
                </BouncyButton>
                <BouncyButton onClick={() => { setOpen(false); signOut(); }} className="font-sans text-[15px] uppercase tracking-wider text-[var(--smoke)] hover:text-[var(--tomato)] transition-colors" style={{ background: 'none', border: 'none', paddingRight: 2 }}>
                  Sign out
                </BouncyButton>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
      {showPricing && createPortal(<PricingPopup onDismiss={() => setShowPricing(false)} />, document.body)}
      {showSettings && settingsOriginRect && (
        <SettingsPopup onDismiss={() => { setShowSettings(false); setTimeout(() => setOpen(false), 500); }} onRescan={() => { setOpen(false); onRescan(); }} originRect={settingsOriginRect} />
      )}
    </div>
  );
}

/* ─── Settings Popup ─── */
function SettingsPopup({ onDismiss, onRescan, originRect }: { onDismiss: () => void; onRescan: () => void; originRect: DOMRect }) {
  const userQuery = useQuery(api.users.getMe);
  const setUsernameMutation = useMutation(api.users.setUsername);
  const revokeBiometricConsentMutation = useMutation(api.users.revokeBiometricConsent);
  const deleteAccountMutation = useMutation(api.users.deleteCurrentUserData);
  const { theme, renderQuality, language, aiTrainingOptOut, updateTheme, updateRenderQuality, updateLanguage, updateAiTrainingOptOut } = useSettings();

  const [phase, setPhase] = useState<'entering' | 'open' | 'closing'>('entering');
  const [usernameValue, setUsernameValue] = useState(userQuery?.username ?? '');
  const [usernameError, setUsernameError] = useState('');
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameSaved, setUsernameSaved] = useState(false);

  const [revokingConsent, setRevokingConsent] = useState(false);
  const [consentRevoked, setConsentRevoked] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const PANEL_W = 600, PANEL_H = 680;

  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setPhase('open')));
    return () => cancelAnimationFrame(id);
  }, []);

  const dismiss = () => { setPhase('closing'); setTimeout(onDismiss, 270); };

  const handleSaveUsername = async () => {
    if (usernameValue.trim().length < 2) return;
    setUsernameError(''); setUsernameLoading(true);
    try {
      await setUsernameMutation({ username: usernameValue.trim() });
      setUsernameSaved(true); setTimeout(() => setUsernameSaved(false), 2000);
    } catch (err) { setUsernameError(err instanceof ConvexError ? String(err.data) : 'Something went wrong. Please try again.'); }
    finally { setUsernameLoading(false); }
  };

  const handleRevokeConsent = async () => {
    setRevokingConsent(true);
    try {
      await revokeBiometricConsentMutation();
      setConsentRevoked(true);
    } catch { /* non-fatal */ }
    finally { setRevokingConsent(false); }
  };

  const handleDownloadData = () => {
    if (!userQuery) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      account: {
        username: userQuery.username,
        email: userQuery.email,
        credits: userQuery.credits,
        biometricConsentAt: userQuery.biometricConsentAt ? new Date(userQuery.biometricConsentAt).toISOString() : null,
        biometricConsentVersion: userQuery.biometricConsentVersion ?? null,
        aiTrainingOptOut: userQuery.aiTrainingOptOut ?? false,
      },
      note: 'Scan images and 3D models are not included in this export. Contact support to request full media export.',
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'shapeup-my-data.json'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteAccount = async () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    setDeleting(true); setDeleteError('');
    try {
      await deleteAccountMutation();
      dismiss();
      window.location.href = '/';
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Something went wrong');
      setDeleting(false);
    }
  };

  const isOpen = phase === 'open';
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const lerpEase = 'cubic-bezier(0.32, 0.72, 0, 1)';
  const lerpDur = isOpen ? '480ms' : '240ms';
  const panelTransition = phase === 'entering' ? 'none' : `top ${lerpDur} ${lerpEase}, left ${lerpDur} ${lerpEase}, width ${lerpDur} ${lerpEase}, height ${lerpDur} ${lerpEase}, border-radius ${lerpDur} ${lerpEase}, box-shadow 300ms ease`;

  const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--char)' }}>{children}</span>
  );
  const Divider = () => <div style={{ borderTop: '1px dashed rgba(74,58,46,0.15)', margin: '0 0' }} />;

  const themeOptions: { value: Theme; label: string; icon: string }[] = [
    { value: 'light', label: 'Light', icon: '☀' },
    { value: 'system', label: 'System', icon: '⬤' },
    { value: 'dark', label: 'Dark', icon: '◐' },
  ];

  const qualityOptions: { value: RenderQuality; label: string; desc: string }[] = [
    { value: 'performance', label: 'Performance', desc: 'Lighter render, faster on any device' },
    { value: 'balanced', label: 'Balanced', desc: 'Default — looks great on most screens' },
    { value: 'high', label: 'High', desc: '3× pass render for maximum hair definition' },
  ];

  const consentDate = userQuery?.biometricConsentAt
    ? new Date(userQuery.biometricConsentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return createPortal(
    <>
      <div className="fixed inset-0" style={{ zIndex: 10000, background: 'rgba(0,0,0,0.55)', opacity: isOpen ? 1 : 0, transition: 'opacity 320ms ease', pointerEvents: isOpen ? 'auto' : 'none' }} onClick={dismiss} />
      <div style={{ position: 'fixed', zIndex: 10001, top: isOpen ? Math.max(24, (vh - PANEL_H) / 2) : originRect.top, left: isOpen ? (vw - PANEL_W) / 2 : originRect.left, width: isOpen ? PANEL_W : originRect.width, height: isOpen ? Math.min(PANEL_H, vh - 48) : originRect.height, borderRadius: isOpen ? 24 : 18, overflow: 'hidden', background: 'var(--cream)', border: '1px solid rgba(42,32,26,0.1)', boxShadow: isOpen ? '0 32px 90px -16px rgba(0,0,0,0.5)' : '0 20px 50px -12px rgba(0,0,0,0.3)', transition: panelTransition }}>
        <div style={{ position: 'absolute', inset: 0, padding: '44px 52px 44px', display: 'flex', flexDirection: 'column', gap: 24, overflowY: 'auto', opacity: isOpen ? 1 : 0, transition: isOpen ? 'opacity 180ms 280ms ease' : 'opacity 100ms ease' }}>
          <button onClick={dismiss} className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-[var(--smoke)] hover:text-[var(--ink)] hover:bg-[var(--biscuit)] transition-all text-sm">✕</button>
          <h2 className="font-display italic text-[var(--ink)]" style={{ fontWeight: 600, fontSize: 28 }}>Settings</h2>

          {/* ── Account ── */}
          <div className="flex flex-col gap-3">
            <SectionLabel>Account</SectionLabel>
            <div className="flex gap-3">
              <input type="text" value={usernameValue} onChange={e => { setUsernameValue(e.target.value); setUsernameError(''); setUsernameSaved(false); }} placeholder="your username" className="flex-1 font-sans text-[15px] text-[var(--ink)] rounded-xl px-4 py-3" style={{ background: 'var(--biscuit)', border: usernameError ? '1.5px solid var(--tomato)' : '1.5px solid transparent', outline: 'none' }} />
              <BouncyButton onClick={handleSaveUsername} disabled={usernameLoading || usernameValue.trim().length < 2} className="btn-ink font-sans text-[13px]" style={{ padding: '10px 20px', opacity: usernameLoading || usernameValue.trim().length < 2 ? 0.45 : 1 }}>
                {usernameSaved ? '✓ Saved' : usernameLoading ? '…' : 'Save'}
              </BouncyButton>
            </div>
            {usernameError && <span className="font-sans text-[13px] text-[var(--tomato)]">{usernameError}</span>}
            <div className="flex items-center gap-3 mt-1">
              <label className="font-sans text-[13px] text-[var(--char)]" style={{ minWidth: 68 }}>Language</label>
              <select value={language} onChange={e => updateLanguage(e.target.value)} className="settings-lang-select font-sans text-[13px] text-[var(--ink)] rounded-lg px-3 py-2" style={{ background: 'var(--biscuit)', border: '1.5px solid transparent', outline: 'none', cursor: 'pointer' }}>
                <option value="en">English</option>
                <option value="es" disabled>Español (soon)</option>
                <option value="fr" disabled>Français (soon)</option>
              </select>
            </div>
          </div>

          <Divider />

          {/* ── Appearance ── */}
          <div className="flex flex-col gap-3">
            <SectionLabel>Appearance</SectionLabel>
            <div className="flex gap-2">
              {themeOptions.map(opt => (
                <button key={opt.value} onClick={() => updateTheme(opt.value)} className="flex-1 flex flex-col items-center gap-1.5 rounded-xl py-3 transition-all font-sans text-[12px]" style={{ background: theme === opt.value ? 'var(--ink)' : 'var(--biscuit)', color: theme === opt.value ? 'var(--cream)' : 'var(--char)', border: theme === opt.value ? '1.5px solid transparent' : '1.5px solid transparent', fontWeight: theme === opt.value ? 600 : 400 }}>
                  <span style={{ fontSize: 16 }}>{opt.icon}</span>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <Divider />

          {/* ── Render Quality ── */}
          <div className="flex flex-col gap-3">
            <SectionLabel>Render Quality</SectionLabel>
            <div className="flex flex-col gap-2">
              {qualityOptions.map(opt => (
                <button key={opt.value} onClick={() => updateRenderQuality(opt.value)} className="flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-all" style={{ background: renderQuality === opt.value ? 'var(--ink)' : 'var(--biscuit)', color: renderQuality === opt.value ? 'var(--cream)' : 'var(--ink)' }}>
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: renderQuality === opt.value ? 'var(--butter)' : 'var(--smoke)', transition: 'background 200ms' }} />
                  <div className="flex flex-col">
                    <span className="font-sans text-[13px] font-semibold">{opt.label}</span>
                    <span className="font-sans text-[11px]" style={{ opacity: 0.8 }}>{opt.desc}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <Divider />

          {/* ── 3D Scan ── */}
          <div className="flex flex-col gap-3">
            <SectionLabel>3D Scan</SectionLabel>
            <div className="flex items-center justify-between gap-4">
              <p className="font-sans text-[13px] text-[var(--char)] leading-snug" style={{ flex: 1 }}>Rebuild your 3D head model from a new photo.</p>
              <BouncyButton onClick={() => { setPhase('closing'); setTimeout(() => { onDismiss(); onRescan(); }, 270); }} className="btn btn-cream" style={{ padding: '10px 20px', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>✂ Rescan</BouncyButton>
            </div>
          </div>

          <Divider />

          {/* ── Privacy & Data ── */}
          <div className="flex flex-col gap-4">
            <SectionLabel>Privacy & Data</SectionLabel>

            {/* AI training opt-out */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="font-sans text-[13px] font-semibold text-[var(--ink)]">Improve ShapeUp with my scans</span>
                <span className="font-sans text-[11px] text-[var(--char)]">Helps train our hair AI models. Off by default.</span>
              </div>
              <button onClick={() => updateAiTrainingOptOut(!aiTrainingOptOut)} className="relative flex-shrink-0" style={{ width: 42, height: 24, borderRadius: 12, background: !aiTrainingOptOut ? 'var(--smoke)' : 'var(--terracotta)', border: 'none', cursor: 'pointer', transition: 'background 220ms ease', padding: 0 }} aria-checked={!aiTrainingOptOut} role="switch">
                <span style={{ position: 'absolute', top: 3, left: !aiTrainingOptOut ? 3 : 21, width: 18, height: 18, borderRadius: '50%', background: 'var(--cream)', transition: 'left 220ms ease', display: 'block' }} />
              </button>
            </div>

            {/* Biometric consent */}
            <div className="flex flex-col gap-1.5 rounded-xl p-3" style={{ background: 'var(--biscuit)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-sans text-[13px] font-semibold text-[var(--ink)]">Biometric consent</span>
                {consentDate && !consentRevoked ? (
                  <span className="font-mono text-[10px]" style={{ color: 'var(--char)' }}>granted {consentDate}</span>
                ) : (
                  <span className="font-mono text-[10px]" style={{ color: 'var(--char)' }}>not granted</span>
                )}
              </div>
              <p className="font-sans text-[11px] leading-snug" style={{ color: 'var(--char)', margin: 0 }}>
                {userQuery?.biometricConsentVersion ?? 'biometric-notice-2026-06-08'} — facial scan data stored for 3D model generation.
              </p>
              {(consentDate && !consentRevoked) && (
                <BouncyButton onClick={handleRevokeConsent} disabled={revokingConsent} className="font-sans text-[11px] self-start mt-1" style={{ background: 'none', border: '1px solid var(--tomato)', color: 'var(--tomato)', borderRadius: 8, padding: '4px 12px', opacity: revokingConsent ? 0.5 : 1 }}>
                  {revokingConsent ? '…' : 'Revoke consent'}
                </BouncyButton>
              )}
              {consentRevoked && <span className="font-sans text-[11px]" style={{ color: 'var(--moss)' }}>✓ Consent revoked. Your scan data will be cleared.</span>}
            </div>

            {/* Download data */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="font-sans text-[13px] font-semibold text-[var(--ink)]">Download my data</span>
                <span className="font-sans text-[11px] text-[var(--char)]">Export your account info as JSON (GDPR / CCPA).</span>
              </div>
              <BouncyButton onClick={handleDownloadData} disabled={!userQuery} className="font-sans text-[12px] flex-shrink-0" style={{ background: 'var(--biscuit)', border: '1px solid rgba(42,32,26,0.2)', color: 'var(--ink)', borderRadius: 10, padding: '7px 14px', opacity: !userQuery ? 0.4 : 1 }}>
                ↓ Export
              </BouncyButton>
            </div>

            {/* Delete account */}
            <div className="flex flex-col gap-2 rounded-xl p-3" style={{ background: 'rgba(169,49,31,0.06)', border: '1px solid rgba(169,49,31,0.18)' }}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="font-sans text-[13px] font-semibold" style={{ color: 'var(--cherry)' }}>Delete account</span>
                  <span className="font-sans text-[11px] text-[var(--char)]">Permanently removes your data. This cannot be undone.</span>
                </div>
                <BouncyButton onClick={handleDeleteAccount} disabled={deleting} className="font-sans text-[12px] flex-shrink-0" style={{ background: deleteConfirm ? 'var(--cherry)' : 'none', border: '1px solid var(--cherry)', color: deleteConfirm ? 'var(--cream)' : 'var(--cherry)', borderRadius: 10, padding: '7px 14px', opacity: deleting ? 0.5 : 1, transition: 'background 200ms, color 200ms' }}>
                  {deleting ? '…' : deleteConfirm ? 'Confirm delete' : 'Delete'}
                </BouncyButton>
              </div>
              {deleteConfirm && !deleting && (
                <div className="flex items-center gap-2">
                  <span className="font-sans text-[11px]" style={{ color: 'var(--cherry)' }}>All scans, projects, and your account will be deleted.</span>
                  <button onClick={() => setDeleteConfirm(false)} className="font-sans text-[11px]" style={{ background: 'none', border: 'none', color: 'var(--char)', cursor: 'pointer', padding: 0 }}>Cancel</button>
                </div>
              )}
              {deleteError && <span className="font-sans text-[11px]" style={{ color: 'var(--tomato)' }}>{deleteError}</span>}
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

/* ─── Scan Now Popup ─── */
function ScanNowPopup({ onLetsDo, onDismiss }: { onLetsDo: () => void; onDismiss: () => void }) {
  const [show, setShow] = useState(false);
  const [closing, setClosing] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShow(true), 16); return () => clearTimeout(t); }, []);
  const dismiss = () => { setClosing(true); setTimeout(onDismiss, 420); };
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ background: show && !closing ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)', transition: 'background 400ms ease' }}>
      <div style={{ transition: 'transform 380ms cubic-bezier(.2,.85,.2,1)', transform: closing ? 'translateY(100vh)' : show ? 'translateY(0)' : 'translateY(-100vh)' }}>
        <div className="relative rounded-3xl flex flex-col items-center gap-5" style={{ background: 'var(--cream)', border: '1px solid rgba(42,32,26,0.1)', boxShadow: '0 30px 80px -20px rgba(0,0,0,0.45)', minWidth: 380, padding: '44px 44px 40px' }}>
          <button onClick={dismiss} className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-[var(--smoke)] hover:text-[var(--ink)] hover:bg-[var(--biscuit)] transition-all text-sm">✕</button>
          <div style={{ width: 52, transform: 'rotate(186deg)' }}><BarberMascot /></div>
          <h2 className="font-display italic text-[var(--ink)] text-center" style={{ fontWeight: 600, fontSize: 28 }}>Scan now!</h2>
          <p className="font-sans text-[var(--smoke)] text-center leading-snug" style={{ fontSize: 15 }}>Drop in the chair and start styling yourself in 3D!</p>
          <BouncyButton onClick={onLetsDo} className="btn btn-tomato w-full" style={{ padding: '20px 48px', fontSize: 26, fontFamily: 'var(--font-fraunces), Georgia, serif', fontVariationSettings: "'SOFT' 100, 'WONK' 0, 'opsz' 144", fontWeight: 900, letterSpacing: '-0.02em' }}>Take Picture</BouncyButton>
        </div>
      </div>
    </div>
  );
}

/* ─── Scan progress bars ─── */
type BarSegment = { to: number; ms: number } | { hold: number };
const SCAN_STEPS: { label: string; holdAt88: boolean; segments: BarSegment[] }[] = [
  { label: 'Scanning geometry', holdAt88: false, segments: [{ to: 28, ms: 350 }, { hold: 400 }, { to: 64, ms: 450 }, { hold: 300 }, { to: 100, ms: 500 }] },
  { label: 'Mapping features', holdAt88: false, segments: [{ to: 16, ms: 350 }, { hold: 600 }, { to: 44, ms: 550 }, { hold: 450 }, { to: 78, ms: 500 }, { hold: 250 }, { to: 100, ms: 350 }] },
  { label: 'Generating mesh', holdAt88: false, segments: [{ to: 11, ms: 350 }, { hold: 600 }, { to: 34, ms: 550 }, { hold: 500 }, { to: 62, ms: 600 }, { hold: 400 }, { to: 86, ms: 450 }, { hold: 200 }, { to: 100, ms: 350 }] },
  { label: 'Building model', holdAt88: true, segments: [{ to: 19, ms: 600 }, { hold: 1400 }, { to: 47, ms: 1000 }, { hold: 1200 }, { to: 88, ms: 1800 }] },
];

function easeOut(t: number) { return 1 - Math.pow(1 - t, 3); }

function OrganicBar({ label, active = false, segments, holdAt88 = false, complete = false, onComplete }: {
  label: string; active?: boolean; segments: BarSegment[]; holdAt88?: boolean; complete?: boolean; onComplete?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [fillPct, setFillPct] = useState(0);
  const [completing, setCompleting] = useState(false);
  const rafRef = useRef<number>(0);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepRef = useRef(0);
  const stepStartRef = useRef(0);
  const fromPctRef = useRef(0);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const completeRef = useRef(complete);
  completeRef.current = complete;

  useEffect(() => { if (active) setVisible(true); }, [active]);

  useEffect(() => {
    if (!visible || completedRef.current) return;
    stepRef.current = 0; stepStartRef.current = performance.now(); fromPctRef.current = 0;
    const advance = (now: number) => {
      if (completeRef.current || completedRef.current) return;
      const seg = segments[stepRef.current];
      if (!seg) return;
      if ('hold' in seg) { holdRef.current = setTimeout(() => { if (completeRef.current || completedRef.current) return; stepRef.current++; stepStartRef.current = performance.now(); rafRef.current = requestAnimationFrame(advance); }, seg.hold); return; }
      const elapsed = now - stepStartRef.current;
      const t = Math.min(elapsed / seg.ms, 1);
      const pct = fromPctRef.current + easeOut(t) * (seg.to - fromPctRef.current);
      setFillPct(pct);
      if (t >= 1) {
        fromPctRef.current = seg.to; stepRef.current++; stepStartRef.current = now;
        if (stepRef.current < segments.length) { rafRef.current = requestAnimationFrame(advance); }
        else if (!holdAt88 && !completedRef.current) { completedRef.current = true; onCompleteRef.current?.(); }
      } else { rafRef.current = requestAnimationFrame(advance); }
    };
    rafRef.current = requestAnimationFrame(advance);
    return () => { cancelAnimationFrame(rafRef.current); if (holdRef.current) clearTimeout(holdRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!complete) return;
    cancelAnimationFrame(rafRef.current);
    if (holdRef.current) clearTimeout(holdRef.current);
    completedRef.current = true; setVisible(true); setCompleting(true); setFillPct(100); onCompleteRef.current?.();
  }, [complete]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '100%', opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(10px)', transition: 'opacity 400ms ease, transform 400ms ease' }}>
      <span style={{ fontFamily: 'var(--font-dmsans)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,248,234,0.55)', fontWeight: 500 }}>{label}</span>
      <div style={{ height: 11, borderRadius: 9999, background: 'rgba(42,32,26,0.1)', overflow: 'hidden', position: 'relative' }}>
        <div className="organic-bar-fill" style={{ width: `${fillPct}%`, transition: completing ? 'width 700ms ease-out' : 'none' }} />
      </div>
    </div>
  );
}

type ScanPhase = 'username' | 'camera' | 'verify' | 'processing';
const BIOMETRIC_CONSENT_VERSION = 'biometric-notice-2026-06-08';

/* ─── Letter Fade ─── */
function LetterFade({ text, startDelay = 0, charDelay = 26 }: { text: string; startDelay?: number; charDelay?: number }) {
  return (
    <>
      {text.split('').map((char, i) => (
        <span key={i} style={{ display: 'inline', opacity: 0, animation: 'letter-fade-in 80ms ease forwards', animationDelay: `${startDelay + i * charDelay}ms` }}>
          {char === ' ' ? ' ' : char}
        </span>
      ))}
    </>
  );
}

const SELFIE_REQS = [
  { icon: '◉', label: 'Head centered in the oval' },
  { icon: '☀', label: 'Even, natural lighting' },
  { icon: '→', label: 'Face forward, look at yourself' },
  { icon: '□', label: 'Solid color background' },
];

/* ─── Live Checklist ─── */
function LiveChecklist({ checks }: { checks: ChecksMap | null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 330 }}>
      <p style={{ fontFamily: 'var(--font-dmsans)', fontSize: 18, fontWeight: 600, color: 'rgba(255,248,234,0.5)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 24 }}>The barber&rsquo;s checklist</p>
      {CHECK_ORDER.map((key: CheckKey, i: number) => {
        const state = checks?.[key] ?? 'idle';
        return (
          <div key={key} className={`lchk-row lchk-${state}`} style={{ ['--lchk-i' as string]: i }}>
            <span className="lchk-pin">
              {state === 'pass' ? (
                <svg key="ok" width="13" height="13" viewBox="0 0 14 14" fill="none" className="lchk-tick">
                  <path d="M2.5 7.5L5.6 10.5L11.5 3.5" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : <span className="lchk-dot" />}
            </span>
            <span className="lchk-label font-sans">{CHECK_META[key].label}</span>
          </div>
        );
      })}
      <p className="font-display lchk-footnote">the oval turns <span style={{ color: 'var(--butter)' }}>butter</span> when you&rsquo;re ready ✂</p>
    </div>
  );
}

/* ─── Selfie fly overlay ─── */
function SelfieFlightOverlay({ imageUrl, onDone }: { imageUrl: string; onDone: () => void }) {
  const [flying, setFlying] = useState(false);
  const [vw, setVw] = useState(1920);
  const [vh, setVh] = useState(1080);
  useEffect(() => {
    setVw(window.innerWidth); setVh(window.innerHeight);
    const t1 = setTimeout(() => setFlying(true), 40);
    const t2 = setTimeout(onDone, 880);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const size = flying ? 44 : 200;
  const left = flying ? vw - 24 - 44 : vw / 2 - 100;
  const top = flying ? 16 : vh / 2 - 100;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, pointerEvents: 'none' }}>
      <img src={imageUrl} alt="" style={{ position: 'absolute', width: size, height: size, top, left, borderRadius: flying ? '50%' : 14, objectFit: 'cover', boxShadow: '0 8px 32px rgba(0,0,0,0.45)', transition: 'top 750ms cubic-bezier(.4,0,.2,1), left 750ms cubic-bezier(.4,0,.2,1), width 750ms cubic-bezier(.4,0,.2,1), height 750ms cubic-bezier(.4,0,.2,1), border-radius 400ms ease', willChange: 'top, left, width, height' }} />
    </div>
  );
}

/* ─── Scan Popup ─── */
function ScanPopup({ onScanComplete, onDismiss, onNoTokens, needsUsername = false }: {
  onScanComplete: (p: UserHeadProfile, sid: string | null, url: string | null, fromRect?: DOMRect, isFirstScan?: boolean, splatUrl?: string) => void;
  onDismiss: () => void;
  onNoTokens?: () => void;
  needsUsername?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const wasFirstScanRef = useRef(needsUsername);
  const setUsernameMutation = useMutation(api.users.setUsername);
  const [usernameValue, setUsernameValue] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [phase, setPhase] = useState<ScanPhase>(needsUsername ? 'username' : 'camera');
  const [cameraKey, setCameraKey] = useState(0);
  const [captured, setCaptured] = useState<{ profile: UserHeadProfile; sid: string | null; url: string | null } | null>(null);
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [showVerifyBtns, setShowVerifyBtns] = useState(false);
  const [collapsing, setCollapsing] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [paywallDisabled, setPaywallDisabled] = useState(false);
  const [faceliftStatus, setFaceliftStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');
  const [faceliftError, setFaceliftError] = useState<string | null>(null);
  const [activeBarIndex, setActiveBarIndex] = useState(0);
  const faceliftAbortRef = useRef<AbortController | null>(null);
  const isDismissing = useRef(false);
  const hasConsent = useQuery(api.users.hasBiometricConsent);
  const recordConsent = useMutation(api.users.recordBiometricConsent);
  const [showConsentDialog, setShowConsentDialog] = useState(false);
  const [slideIn, setSlideIn] = useState(false);
  const [rotateIn, setRotateIn] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showRequirements, setShowRequirements] = useState(false);
  const [liveChecks, setLiveChecks] = useState<ChecksMap | null>(null);
  const [contentVisible, setContentVisible] = useState(true);

  useEffect(() => { fetch('/api/config').then(r => r.json()).then(d => setPaywallDisabled(d.paywallDisabled ?? false)); }, []);

  useEffect(() => {
    const t1 = setTimeout(() => setSlideIn(true), 15);
    const t2 = setTimeout(() => setRotateIn(true), 250);
    if (!needsUsername) {
      const t3 = setTimeout(() => setExpanded(true), 620);
      const t4 = setTimeout(() => setShowRequirements(true), 1200);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
    }
    return () => { clearTimeout(t1); clearTimeout(t2); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = () => {
    if (isDismissing.current) return;
    if (phase === 'processing') return;
    isDismissing.current = true;
    faceliftAbortRef.current?.abort();
    setCollapsing(true);
    setTimeout(() => setExiting(true), 350);
    setTimeout(onDismiss, 850);
  };

  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameError(''); setUsernameLoading(true);
    try {
      await setUsernameMutation({ username: usernameValue.trim() });
      setContentVisible(false);
      setTimeout(() => setExpanded(true), 120);
      setTimeout(() => { setPhase('camera'); setContentVisible(true); }, 500);
      setTimeout(() => setShowRequirements(true), 900);
    } catch (err: unknown) { setUsernameError(err instanceof ConvexError ? String(err.data) : 'Something went wrong. Please try again.'); setUsernameLoading(false); }
  };

  const processCapture = useCallback(async (dataUrl: string): Promise<{ profile: UserHeadProfile; sessionId: string | null; url: string | null }> => {
    const profile: UserHeadProfile = {
      headProportions: { width: 1.6, height: 2.0, crownY: 1.0 },
      anchors: { earLeft: [-0.85, 0, 0], earRight: [0.85, 0, 0] },
      hairMeasurements: { crownHeight: 0.3, sideWidth: 0.2, backLength: 0.25, flatness: 0.5, hairline: 0.28, hairThickness: 0.16 },
      faceScanData: { landmarks: [], imageDataUrl: dataUrl, imageWidth: 640, imageHeight: 640 },
      currentStyle: {
        preset: 'default',
        hairType: 'straight',
        colorRGB: '#3b1f0a',
        params: { topLength: 1, sideLength: 1, backLength: 1, messiness: 0, taper: 0.5, pc1: 0, pc2: 0, pc3: 0, pc4: 0, pc5: 0, pc6: 0 },
      },
    };
    let sessionId: string | null = null;
    let url: string | null = null;
    if (hasConsent) {
      try {
        const res = await fetch('/api/save-scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageDataUrl: dataUrl, currentProfile: buildCurrentProfilePayload(profile) }),
        });
        const data = await res.json();
        sessionId = data.sessionId ?? null;
        url = data.downloadUrl ?? null;
      } catch { /* non-fatal */ }
    }
    return { profile, sessionId, url: url ?? dataUrl };
  }, [hasConsent]);

  const handleCapture = (p: UserHeadProfile, sid: string | null, url: string | null) => {
    setCaptured({ profile: p, sid, url }); setPhase('verify'); setTimeout(() => setShowVerifyBtns(true), 200);
  };

  const handleRetake = () => {
    setShowVerifyBtns(false);
    setTimeout(() => { setCaptured(null); setPhase('camera'); setCameraKey(k => k + 1); }, 350);
  };

  const runFacelift = async () => {
    if (!captured || !capturedDataUrl) return;
    setShowVerifyBtns(false); setPhase('processing'); setFaceliftStatus('processing'); setFaceliftError(null); setActiveBarIndex(0);
    const abort = new AbortController();
    faceliftAbortRef.current = abort;

    // Save scan now if consent was missing at capture time
    let sid = captured.sid;
    let scanUrl = captured.url;
    if (!sid) {
      try {
        const res = await fetch('/api/save-scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageDataUrl: capturedDataUrl, currentProfile: buildCurrentProfilePayload(captured.profile) }),
        });
        const data = await res.json();
        sid = data.sessionId ?? null;
        scanUrl = data.downloadUrl ?? scanUrl;
      } catch { /* non-fatal */ }
    }

    try {
      const submitRes = await fetch('/api/facelift', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageDataUrl: capturedDataUrl }), signal: abort.signal });
      if (submitRes.status === 402) {
        dismiss();
        setTimeout(() => onNoTokens?.(), 900);
        return;
      }
      if (submitRes.status === 401) {
        const checkout = await fetch('/api/stripe/checkout', { method: 'POST' });
        const { url } = await checkout.json() as { url?: string };
        if (url) { window.location.href = url; return; }
      }
      if (submitRes.status === 403) {
        setFaceliftStatus('idle');
        setPhase('verify');
        setTimeout(() => setShowVerifyBtns(true), 200);
        setShowConsentDialog(true);
        return;
      }
      if (!submitRes.ok) { const body = await submitRes.text().catch(() => ''); throw new Error(`Couldn't start 3D build (${submitRes.status})${body ? ': ' + body : ''}`); }
      const { splatUrl } = await submitRes.json() as { jobId?: string; splatUrl?: string };
      if (!splatUrl) throw new Error('Server did not return a 3D result URL');
      if (!splatUrl || abort.signal.aborted) return;
      setFaceliftStatus('done');
      setTimeout(() => {
        if (isDismissing.current) return;
        isDismissing.current = true;
        const fromRect = panelRef.current?.getBoundingClientRect() ?? undefined;
        setExiting(true);
        setTimeout(() => { onScanComplete(captured.profile, sid, scanUrl, fromRect, wasFirstScanRef.current, splatUrl!); }, 600);
      }, 900);
    } catch (err) {
      if (abort.signal.aborted) return;
      setFaceliftError(err instanceof Error ? err.message : String(err));
      setFaceliftStatus('error');
    }
  };

  const handleProceed = async () => {
    if (!captured || !capturedDataUrl) return;
    if (!hasConsent) { setShowConsentDialog(true); return; }
    await runFacelift();
  };

  const panelTransform = exiting
    ? 'perspective(1000px) translateX(-120%) rotateY(90deg)'
    : rotateIn ? 'perspective(1000px) translateX(0) rotateY(0deg)'
    : slideIn ? 'perspective(1000px) translateX(-16.667%) rotateY(90deg)'
    : 'perspective(1000px) translateX(-120%) rotateY(90deg)';

  const panelTransition = exiting ? 'transform 500ms cubic-bezier(.2,.85,.2,1)' : collapsing ? 'width 460ms cubic-bezier(.4,0,1,1)' : expanded ? 'width 500ms cubic-bezier(.2,.85,.2,1)' : rotateIn ? 'transform 380ms cubic-bezier(.2,.85,.2,1)' : slideIn ? 'transform 280ms cubic-bezier(.2,.85,.2,1)' : 'none';
  const scanStatusMessage =
    phase === 'username'
      ? usernameError || 'Choose a username to continue to your scan.'
      : phase === 'camera'
        ? 'Camera scan is ready.'
        : phase === 'verify'
          ? 'Photo captured. Retake or proceed to build your 3D model.'
          : faceliftStatus === 'error'
            ? `3D model build failed. ${faceliftError ?? 'Unknown error'}`
            : 'Building your 3D model. This takes about two minutes.';

  return (
    <div className="fixed inset-0 z-[10000]" style={{ background: exiting ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,0.65)', transition: 'background 400ms ease' }} onClick={dismiss}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-popup-title"
        aria-describedby="scan-popup-status"
        onClick={e => e.stopPropagation()}
        style={{ position: 'absolute', left: '5vw', top: '5vh', height: '90vh', width: (collapsing || exiting) ? '30vw' : expanded ? '90vw' : '30vw', transform: panelTransform, transition: panelTransition, background: '#201a13', borderRadius: 28, boxShadow: '0 40px 100px -24px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,248,234,0.08)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        <div id="scan-popup-status" className="sr-only" aria-live="polite" aria-atomic="true">{scanStatusMessage}</div>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Left panel */}
          <div style={{ width: (expanded && !collapsing && !exiting) ? '40vw' : '0vw', overflow: 'hidden', flexShrink: 0, transition: 'width 750ms cubic-bezier(.2,.85,.2,1)', borderRight: '1px solid rgba(255,248,234,0.07)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: (expanded && !collapsing && !exiting) ? '40px 52px' : '0' }}>
            {phase !== 'processing' && showRequirements && <LiveChecklist checks={liveChecks} />}
            {phase === 'processing' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18, width: '100%', maxWidth: 320 }}>
                <p style={{ fontFamily: 'var(--font-fraunces)', fontStyle: 'italic', fontVariationSettings: "'SOFT' 50, 'WONK' 1, 'opsz' 144", fontSize: 20, fontWeight: 600, color: 'var(--cream)', opacity: 0.85, marginBottom: 4 }}>
                  {faceliftStatus === 'error' ? 'Something went wrong' : 'Analyzing your look...'}
                </p>
                {SCAN_STEPS.map((s, i) => (
                  <OrganicBar key={s.label} label={s.label} active={i <= activeBarIndex} segments={s.segments} holdAt88={s.holdAt88} complete={faceliftStatus === 'done'} onComplete={() => setActiveBarIndex(prev => Math.max(prev, i + 1))} />
                ))}
                {faceliftStatus === 'processing' && <p style={{ fontFamily: 'var(--font-dmsans)', fontSize: 11, color: 'rgba(255,248,234,0.35)', marginTop: 4, fontStyle: 'italic' }}>Building your 3D model — this takes about 2 minutes</p>}
                {faceliftStatus === 'error' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                    <p style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10, color: 'rgba(255,100,80,0.8)', lineHeight: 1.4, wordBreak: 'break-word' }}>{faceliftError ?? 'Unknown error'}</p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" onClick={() => { setFaceliftStatus('idle'); setFaceliftError(null); setPhase('processing'); runFacelift(); }} style={{ flex: 1, padding: '8px 12px', background: 'var(--tomato)', color: 'var(--cream)', border: 'none', borderRadius: 8, fontFamily: 'var(--font-dmsans)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Try again</button>
                      <button type="button" onClick={() => { faceliftAbortRef.current?.abort(); setFaceliftStatus('idle'); setFaceliftError(null); setPhase('camera'); setCaptured(null); setCapturedDataUrl(null); setCameraKey(k => k + 1); }} style={{ flex: 1, padding: '8px 12px', background: 'rgba(255,248,234,0.08)', color: 'rgba(255,248,234,0.6)', border: 'none', borderRadius: 8, fontFamily: 'var(--font-dmsans)', fontSize: 12, cursor: 'pointer' }}>Retake photo</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right panel */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 28px 20px', flexShrink: 0, borderBottom: '1px solid rgba(255,248,234,0.07)', position: 'relative' }}>
              <h2 id="scan-popup-title" className="type-chonk text-[var(--cream)] select-none" style={{ fontSize: 'clamp(1.8rem, 3.5vw, 3rem)', lineHeight: 1 }}>
                {phase === 'username' ? "Let's meet you" : 'Take a selfie!'}
              </h2>
              <button type="button" aria-label="Close scan dialog" onClick={dismiss} className="absolute right-7 w-9 h-9 flex items-center justify-center rounded-full transition-all" style={{ color: 'rgba(255,248,234,0.5)', background: 'rgba(255,248,234,0.07)' }}>✕</button>
            </div>

            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 28px', position: 'relative', minHeight: 0, opacity: contentVisible ? 1 : 0, transition: 'opacity 280ms ease' }}>
              {phase === 'username' && (
                <form onSubmit={handleUsernameSubmit} style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <h2 className="type-chonk" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', color: 'var(--cream)', lineHeight: 1, margin: 0 }}>Set up!</h2>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label htmlFor="scan-username" style={{ fontFamily: 'var(--font-dmsans)', fontSize: 13, color: 'rgba(255,248,234,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, margin: 0 }}>Choose a username</label>
                    <p id="scan-username-help" style={{ fontFamily: 'var(--font-dmsans)', fontSize: 14, color: 'rgba(255,248,234,0.6)', margin: 0, lineHeight: 1.5 }}>Letters, numbers, and underscores only.</p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <input
                      id="scan-username"
                      autoFocus
                      type="text"
                      value={usernameValue}
                      onChange={e => { setUsernameValue(e.target.value); setUsernameError(''); }}
                      placeholder="e.g. freshcuts_mike"
                      maxLength={20}
                      aria-invalid={usernameError ? 'true' : 'false'}
                      aria-describedby={usernameError ? 'scan-username-error scan-username-help' : 'scan-username-help'}
                      style={{ fontFamily: 'var(--font-dmsans)', fontSize: 16, fontWeight: 500, padding: '14px 18px', borderRadius: 14, border: usernameError ? '1px solid rgba(220,80,60,0.7)' : '1px solid rgba(255,248,234,0.14)', background: 'rgba(255,248,234,0.06)', color: 'var(--cream)', outline: 'none', width: '100%', boxSizing: 'border-box', transition: 'border-color 200ms ease' }}
                    />
                    {usernameError && <p id="scan-username-error" role="alert" style={{ fontFamily: 'var(--font-dmsans)', fontSize: 12, color: 'rgba(220,80,60,0.9)', margin: 0 }}>{usernameError}</p>}
                  </div>
                  <button type="submit" disabled={usernameLoading || usernameValue.trim().length < 2} style={{ fontFamily: 'var(--font-dmsans)', fontSize: 14, fontWeight: 700, padding: '13px 0', borderRadius: 14, border: 'none', background: usernameLoading || usernameValue.trim().length < 2 ? 'rgba(255,248,234,0.12)' : 'var(--cream)', color: usernameLoading || usernameValue.trim().length < 2 ? 'rgba(255,248,234,0.3)' : 'var(--ink)', cursor: usernameLoading || usernameValue.trim().length < 2 ? 'default' : 'pointer', width: '100%', transition: 'background 200ms ease, color 200ms ease', letterSpacing: '0.04em' }}>
                    {usernameLoading ? 'Saving…' : 'Continue →'}
                  </button>
                </form>
              )}

              {phase === 'camera' && (
                <div key={cameraKey} style={{ width: '100%', maxWidth: 'min(460px, calc(90vh - 340px))', position: 'relative' }}>
                  <ScanCamera hairType="straight" processCapture={processCapture} onScanComplete={handleCapture} onDataUrlReady={(d) => setCapturedDataUrl(d)} onDismiss={dismiss} onNoTokens={() => setShowPricing(true)} paywallDisabled={paywallDisabled} onChecksChange={(c) => setLiveChecks(c)} />
                </div>
              )}

              {(phase === 'verify' || phase === 'processing') && captured?.url && (
                <div style={{ width: '100%', maxWidth: 460, aspectRatio: '1', borderRadius: 18, overflow: 'hidden', boxShadow: '0 20px 60px -16px rgba(0,0,0,0.5)' }}>
                  <img src={captured.url} alt="Your photo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}
              {(phase === 'verify' || phase === 'processing') && !captured?.url && (
                <div style={{ width: '100%', maxWidth: 460, aspectRatio: '1', borderRadius: 18, background: 'rgba(255,248,234,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 60, opacity: 0.25, transform: 'rotate(186deg)' }}><BarberMascot isStatic /></div>
                </div>
              )}

              {phase === 'verify' && (
                <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: `translateX(-50%) translateY(${showVerifyBtns ? '0px' : '80px'})`, transition: 'transform 430ms cubic-bezier(.2,.85,.2,1)', display: 'flex', gap: 12, zIndex: 10 }}>
                  <BouncyButton onClick={handleRetake} className="btn btn-cream" style={{ padding: '13px 30px', fontSize: 14 }}>↺ Retake</BouncyButton>
                  <BouncyButton onClick={handleProceed} className="btn btn-tomato" style={{ padding: '13px 30px', fontSize: 14 }}>✓ Proceed</BouncyButton>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ padding: '10px 28px', textAlign: 'center', borderTop: '1px solid rgba(255,248,234,0.06)', flexShrink: 0 }}>
          <span className="font-display italic text-sm" style={{ color: 'rgba(255,248,234,0.35)' }}>the looking glass ✂</span>
        </div>
      </div>

      {showPricing && <PricingPopup onDismiss={() => setShowPricing(false)} />}
      {showConsentDialog && <BiometricConsentDialog onAccept={async () => { await recordConsent({ noticeVersion: BIOMETRIC_CONSENT_VERSION }); setShowConsentDialog(false); runFacelift(); }} onCancel={() => setShowConsentDialog(false)} />}
    </div>
  );
}

/* ─── Project types ─── */
interface ProjectDoc {
  _id: Id<'projects'>;
  name: string;
  thumbnailUrl?: string;
  thumbnailS3Key?: string;
  updatedAt: number;
  savedAt?: number;
  splatS3Key?: string;
}

/* ─── Flying Card ─── */
function FlyingCard({ fromRect, toPoint, thumbnailUrl, onDone }: { fromRect: DOMRect; toPoint: { x: number; y: number }; thumbnailUrl?: string; onDone: () => void }) {
  const elRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const el = elRef.current; if (!el) return;
    const sx = fromRect.left + fromRect.width / 2, sy = fromRect.top + fromRect.height / 2;
    const ex = toPoint.x, ey = toPoint.y;
    const cpX = sx * 0.4 + ex * 0.6, cpY = Math.min(sy, ey) - 170;
    const duration = 720; let startTime = 0;
    const tick = (now: number) => {
      if (!startTime) startTime = now;
      const raw = Math.min((now - startTime) / duration, 1);
      const t = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;
      const x = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * cpX + t * t * ex;
      const y = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * cpY + t * t * ey;
      el.style.transform = `translate(${x - sx}px, ${y - sy}px) scale(${1 - t * 0.8})`;
      el.style.opacity = String(raw > 0.7 ? Math.max(0, 1 - (raw - 0.7) / 0.3) : 1);
      if (raw < 1) rafRef.current = requestAnimationFrame(tick); else onDoneRef.current();
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div ref={elRef} style={{ position: 'fixed', left: fromRect.left, top: fromRect.top, width: fromRect.width, height: fromRect.height, borderRadius: 16, overflow: 'hidden', zIndex: 9999, pointerEvents: 'none', boxShadow: '0 12px 40px rgba(0,0,0,0.35)', transformOrigin: 'center center', willChange: 'transform, opacity', border: '1.5px solid rgba(212,175,55,0.7)' }}>
      {thumbnailUrl ? <img src={thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <div style={{ width: '100%', height: '100%', background: 'var(--biscuit)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: 40, opacity: 0.25, transform: 'rotate(186deg)' }}><BarberMascot isStatic color="var(--ink)" /></div></div>}
    </div>,
    document.body
  );
}

function stampDate(ms: number) {
  const d = new Date(ms);
  const mon = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  return `${mon} ${String(d.getDate()).padStart(2, '0')} '${String(d.getFullYear()).slice(2)}`;
}

/* ─── Delete Confirm Popup ─── */
function DeleteConfirmPopup({ projectName, onConfirm, onCancel }: { projectName: string; onConfirm: () => void; onCancel: () => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVisible(true), 16); return () => clearTimeout(t); }, []);
  const cancel = () => { setVisible(false); setTimeout(onCancel, 260); };
  const confirm = () => { setVisible(false); setTimeout(onConfirm, 260); };
  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: visible ? 'rgba(10,8,6,0.72)' : 'rgba(10,8,6,0)', transition: 'background 260ms ease' }}
      onClick={cancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--cream)', borderRadius: 24, padding: '36px 44px', boxShadow: '0 32px 80px -20px rgba(0,0,0,0.5)', border: '1px solid rgba(42,32,26,0.1)', minWidth: 340, maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 20, transform: visible ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.96)', opacity: visible ? 1 : 0, transition: 'transform 280ms cubic-bezier(.2,.85,.2,1), opacity 260ms ease' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h3 className="font-display" style={{ fontSize: 22, fontWeight: 700, fontStyle: 'italic', color: 'var(--ink)', margin: 0 }}>Delete this cut?</h3>
          <p className="font-sans" style={{ fontSize: 14, color: 'var(--smoke)', margin: 0, lineHeight: 1.5 }}>
            Are you sure you want to delete <strong style={{ color: 'var(--ink)' }}>{projectName}</strong>?
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <BouncyButton onClick={cancel} className="btn btn-cream flex-1 font-sans" style={{ padding: '12px 0', fontSize: 14 }}>No, keep it</BouncyButton>
          <BouncyButton onClick={confirm} className="flex-1 font-sans" style={{ padding: '12px 0', fontSize: 14, fontWeight: 700, background: 'var(--cherry)', color: 'var(--cream)', border: 'none', borderRadius: 14 }}>Yes, delete</BouncyButton>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ─── Project Card ─── */
function ProjectCard({ project, onClick, rotate = 0, onDelete, onSave, onRename }: { project: ProjectDoc; onClick: () => void; rotate?: number; onDelete?: () => void; onSave?: (cardRect: DOMRect) => void; onRename?: (name: string) => void }) {
  const [zooming, setZooming] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [stamping, setStamping] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [arrowHovered, setArrowHovered] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(project.name);
  const [imgError, setImgError] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const DRAWER_H = 72, EASE = 'cubic-bezier(0,0,0.2,1)', DUR = '270ms';
  const isSaved = !!project.savedAt;

  useEffect(() => { setNameValue(project.name); }, [project.name]);
  useEffect(() => { if (editingName) nameInputRef.current?.focus(); }, [editingName]);

  const commitRename = () => {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== project.name) onRename?.(trimmed);
    else setNameValue(project.name);
    setEditingName(false);
  };

  useEffect(() => {
    if (!drawerOpen) return;
    const handler = (e: MouseEvent) => { if (cardRef.current && !cardRef.current.contains(e.target as Node)) setDrawerOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [drawerOpen]);

  return (
    <div ref={cardRef} className={`pcard ${zooming ? 'project-zoom' : ''} ${isDeleting ? 'pcard-crumple' : ''}`}
      onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}
      style={{ transform: isDeleting ? undefined : isHovered ? 'rotate(0deg) translateY(-5px) scale(1.015)' : `rotate(${rotate}deg)`, ['--pcard-wonk' as string]: `${rotate}deg`, boxShadow: isHovered ? '0 22px 44px -14px rgba(42,32,26,0.32)' : 'var(--shadow-md)', outline: isSaved ? '1.5px solid rgba(212,175,55,0.45)' : '1.5px solid rgba(42,32,26,0.14)', pointerEvents: isDeleting ? 'none' : 'auto' }}
    >
      <div className={`pcard-tape ${isSaved ? 'pcard-tape-gold' : ''}`} aria-hidden style={{ transform: drawerOpen ? `translateY(-${DRAWER_H}px) rotate(-7deg)` : 'rotate(-7deg)', transition: `transform ${DUR} ${EASE}, background 320ms ease, border-color 320ms ease` }} />
      <div className="pcard-tray" style={{ height: DRAWER_H }}>
        <button className="pcard-chip pcard-chip-cherry" onClick={(e) => { e.stopPropagation(); setDrawerOpen(false); setShowDeleteConfirm(true); }} aria-label="Delete cut">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></svg>
        </button>
        <button className="pcard-chip pcard-chip-purple" onClick={(e) => { e.stopPropagation(); setDrawerOpen(false); setTimeout(() => setEditingName(true), 120); }} aria-label="Rename cut">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M20.707 5.826l-2.534-2.533a1 1 0 0 0-1.414 0l-1.768 1.768 3.948 3.948 1.768-1.769a1 1 0 0 0 0-1.414zM3 17.25V21h3.75l9.81-9.812-3.948-3.948L3 17.25zM17.25 7.75l-9.5 9.5" /></svg>
        </button>
        <button className={`pcard-chip ${isSaved ? 'pcard-chip-gold' : 'pcard-chip-butter'}`} onClick={(e) => { e.stopPropagation(); setDrawerOpen(false); setTimeout(() => { if (!isSaved) { setStamping(true); setTimeout(() => setStamping(false), 1100); } if (cardRef.current) onSave?.(cardRef.current.getBoundingClientRect()); }, 240); }} aria-label={isSaved ? 'Remove from saved' : 'Save cut'}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M5 3H19V21L12 15.5L5 21Z" /></svg>
        </button>
        <span className="font-mono pcard-tray-label">edit · this cut</span>
      </div>
      <div onClick={() => { if (drawerOpen) return; setZooming(true); setTimeout(onClick, 320); }} className="pcard-content" style={{ transform: drawerOpen ? `translateY(-${DRAWER_H}px)` : 'translateY(0)', transition: `transform ${DUR} ${EASE}` }}>
        <div className="pcard-photo">
          {(project.thumbnailS3Key || project.thumbnailUrl) && !imgError ? <img src={project.thumbnailS3Key ? `/api/img?key=${encodeURIComponent(project.thumbnailS3Key)}` : project.thumbnailUrl} alt={project.name} className="pcard-img" style={{ transform: isHovered ? 'scale(1.045)' : 'scale(1)' }} onError={() => setImgError(true)} /> : <div className="pcard-placeholder"><div style={{ width: 42, opacity: 0.22, transform: 'rotate(186deg)' }}><BarberMascot isStatic color="var(--ink)" /></div></div>}
          <span key={isHovered ? 'on' : 'off'} className={isHovered ? 'pcard-sheen' : ''} aria-hidden />
        </div>
        <div className="pcard-caption">
          {editingName ? (
            <input
              ref={nameInputRef}
              className="font-display pcard-name pcard-name-input"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setNameValue(project.name); setEditingName(false); } }}
              onClick={(e) => e.stopPropagation()}
              maxLength={40}
            />
          ) : (
            <span className="font-display pcard-name">{nameValue}</span>
          )}
          <span className="font-mono pcard-date">{stampDate(project.updatedAt)}</span>
        </div>
      </div>
      {(stamping || isSaved) && <span className={`font-mono pcard-stamp ${stamping ? 'pcard-stamp-slam' : ''}`} aria-hidden style={!stamping ? { transform: drawerOpen ? `translateY(-${DRAWER_H}px) rotate(7deg)` : 'rotate(7deg)', transition: `transform ${DUR} ${EASE}` } : undefined}>KEEPER</span>}
      <button onClick={(e) => { e.stopPropagation(); setDrawerOpen(o => !o); }} onMouseEnter={(e) => { e.stopPropagation(); setArrowHovered(true); }} onMouseLeave={(e) => { e.stopPropagation(); setArrowHovered(false); }} className="pcard-arrow" style={{ bottom: drawerOpen ? DRAWER_H + 12 : 12, color: arrowHovered ? 'var(--tomato)' : 'var(--ink)', borderColor: arrowHovered ? 'rgba(217,78,58,0.7)' : isSaved ? 'rgba(212,175,55,0.55)' : 'rgba(42,32,26,0.25)', transform: arrowHovered ? 'scale(1.16)' : 'scale(1)' }} aria-label="Card actions">
        <svg width="11" height="11" viewBox="0 0 10 10" fill="none" style={{ transform: drawerOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: `transform ${DUR} ${EASE}` }}><path d="M2 6.5L5 3.5L8 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {showDeleteConfirm && (
        <DeleteConfirmPopup
          projectName={project.name}
          onConfirm={() => { setShowDeleteConfirm(false); setTimeout(() => { setIsDeleting(true); setTimeout(() => onDelete?.(), 420); }, 280); }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
}

/* ─── Add Project Button ─── */
function AddProjectButton({ onClick, isEmpty }: { onClick: () => void; isEmpty?: boolean }) {
  const [animPhase, setAnimPhase] = useState<'pre' | 'falling' | 'impact' | 'done'>('pre');
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (!isEmpty) { setAnimPhase('pre'); return; }
    setAnimPhase('pre');
    const t1 = setTimeout(() => setAnimPhase('falling'), 600);
    const t2 = setTimeout(() => setAnimPhase('impact'), 1800);
    const t3 = setTimeout(() => setAnimPhase('done'), 5200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [isEmpty]);
  const isImpact = animPhase === 'impact';
  return (
    <div style={{ position: 'relative', overflow: 'visible' }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <BouncyButton onClick={onClick} className={`fresh-sheet ${hovered ? 'fresh-sheet-live' : ''}`} style={{ aspectRatio: '3/4', width: '100%' }}>
        <svg className="fresh-sheet-ants" aria-hidden><rect rx="15" ry="15" fill="none" stroke="rgba(42,32,26,0.32)" strokeWidth="1.5" strokeDasharray="7 6" /></svg>
        <span className="text-[var(--ink)] font-sans font-bold fresh-sheet-plus" style={{ fontSize: 34, opacity: 0.72, lineHeight: 1, display: 'block', transform: hovered ? 'rotate(90deg) scale(1.18)' : 'rotate(0deg) scale(1)', animation: isImpact ? 'empty-impact-shared 3.4s linear both' : 'none' }}>
          <span style={{ display: 'block', animation: isImpact ? 'empty-plus-swell 0.45s cubic-bezier(.2,.85,.2,1) both' : 'none' }}>+</span>
        </span>
        <span className="font-display fresh-sheet-label" style={{ opacity: hovered ? 1 : 0, transform: hovered ? 'translateY(0)' : 'translateY(6px)' }}>new cut</span>
      </BouncyButton>
    </div>
  );
}

/* ─── Saved Empty State ─── */
function SavedEmptyState({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 64, gap: 26 }}>
      <div className="saved-ghost">
        <svg className="saved-ghost-frame" aria-hidden><rect rx="14" ry="14" fill="none" stroke="rgba(252,245,228,0.3)" strokeWidth="1.5" strokeDasharray="8 7" /></svg>
        <svg className="saved-ghost-bookmark" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="rgba(212,175,55,0.9)" strokeWidth="2" strokeLinejoin="round" aria-hidden><path d="M5 3H19V21L12 15.5L5 21Z" /></svg>
        <span className="font-display saved-ghost-caption">your keepers go here</span>
      </div>
      <p style={{ margin: 0, maxWidth: 380, textAlign: 'center', fontFamily: 'var(--font-dmsans)', fontSize: 14, lineHeight: 1.55, color: 'rgba(252,245,228,0.55)' }}>Nothing pinned yet. Tap the bookmark on any cut and it lands on this wall.</p>
      <BouncyButton onClick={onBrowse} className="btn btn-cream" style={{ padding: '11px 26px', fontSize: 13 }}>✂ Browse my cuts</BouncyButton>
    </div>
  );
}

/* ─── Explore Floor ─── */
const TEASER_TAGS = ['taper', 'crop', 'fringe', 'fade', 'flow', 'buzz'];
function ExploreFloor() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 40px', gap: 36, position: 'relative', overflow: 'hidden' }}>
      <div className="explore-ticket"><span className="inline-block w-2 h-5 barber-pole" /><span className="font-mono explore-ticket-label" style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 700 }}>actively in development</span></div>
      <div className="explore-wall" style={{ justifyContent: 'center' }}>
        {TEASER_TAGS.map((tag, i) => (
          <div key={tag} className="explore-ghost" style={{ ['--eg-wonk' as string]: `${[-1.3, 0.9, -0.6, 1.2, -0.9, 0.7][i]}deg`, ['--eg-phase' as string]: `${i * -0.7}s` }}>
            <div className="explore-ghost-photo"><div style={{ width: 34, opacity: 0.18, transform: 'rotate(186deg)' }}><BarberMascot isStatic color="var(--ink)" /></div></div>
            <span className="font-display explore-ghost-tag">{tag}</span>
            <span className="font-mono explore-ghost-stamp">SOON</span>
          </div>
        ))}
      </div>
      <div className="explore-marquee" aria-hidden><div className="explore-marquee-track font-mono">{Array.from({ length: 10 }).map((_, r) => <span key={r}>FRESH CUTS&nbsp;&nbsp;✂&nbsp;&nbsp;TRENDING STYLES&nbsp;&nbsp;✂&nbsp;&nbsp;BARBER PICKS&nbsp;&nbsp;✂&nbsp;&nbsp;FACE-SHAPE MATCHES&nbsp;&nbsp;✂&nbsp;&nbsp;</span>)}</div></div>
    </div>
  );
}

/* ─── Floor headers ─── */
function HomeTitle({ count }: { count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
      <h1 className="type-chonk" style={{ margin: 0, fontSize: 'clamp(4.5rem, 7vw, 6.5rem)', color: 'var(--ink)', lineHeight: 0.88 }}>My{' '}<span className="hl-swipe-wrap"><span className="hl-swipe" aria-hidden /><span style={{ position: 'relative' }}>Cuts</span></span></h1>
      {count !== undefined && <span key={count} className="font-mono count-ticket">№ {String(count).padStart(2, '0')}</span>}
    </div>
  );
}

function SavedTitle({ count }: { count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
      <h1 className="type-chonk" style={{ margin: 0, fontSize: 'clamp(4.5rem, 7vw, 6.5rem)', color: '#fcf5e4', lineHeight: 0.88, position: 'relative', display: 'inline-block' }}>
        Saved
        <svg className="gold-scribble" viewBox="0 0 220 18" preserveAspectRatio="none" aria-hidden><path d="M4 12 C 40 4, 72 16, 110 9 S 185 4, 216 11" fill="none" stroke="rgba(212,175,55,0.85)" strokeWidth="4" strokeLinecap="round" pathLength="1" /></svg>
      </h1>
      {count !== undefined && count > 0 && <span key={count} className="font-mono count-ticket count-ticket-gold">№ {String(count).padStart(2, '0')}</span>}
    </div>
  );
}

/* ─── Scan Result Popup ─── */
function ScanResultPopup({ imageUrl, onContinue }: { imageUrl: string; onContinue: () => void }) {
  const [interacting, setInteracting] = useState(false);
  const [rotation, setRotation] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setRotation({ x: ((e.clientY - rect.top) / rect.height - 0.5) * 20, y: ((e.clientX - rect.left) / rect.width - 0.5) * -20 });
    setInteracting(true);
  };
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="popup-in flex flex-col items-center gap-5">
        <div ref={containerRef} onMouseMove={handleMouseMove} onMouseLeave={() => { setInteracting(false); setRotation({ x: 0, y: 0 }); }} style={{ transition: interacting ? 'none' : 'transform 600ms cubic-bezier(.2,.85,.2,1)', transform: `perspective(600px) rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)` }}>
          <div className="polaroid scan-pop-in" style={{ maxWidth: 280 }}>
            <div className="tape tape-tl" /><div className="tape tape-tr" />
            <img src={imageUrl} alt="Your scan" className="block w-full rounded-sm object-cover" style={{ aspectRatio: '1' }} />
            <div className="absolute bottom-3 left-0 right-0 text-center"><span className="font-display text-[var(--char)] text-lg" style={{ fontStyle: 'italic', fontWeight: 500 }}>you ✂</span></div>
          </div>
        </div>
        <BouncyButton onClick={onContinue} className="btn btn-tomato" style={{ padding: '12px 28px', fontSize: 14 }}>✂ Style it</BouncyButton>
      </div>
    </div>
  );
}

/* ─── Main Menu ─── */
function MainMenu({ onAdd, onOpenProject, showScanNow, onScanNow, onRescan, profilePillPulse = false, celebratePurchase = false, isSignedIn }: {
  onAdd: () => void; onOpenProject: (project: ProjectDoc) => void; showScanNow: boolean; onScanNow: () => void; onRescan: () => void; profilePillPulse?: boolean; celebratePurchase?: boolean; isSignedIn?: boolean | null;
}) {
  const [showSignIn, setShowSignIn] = useState(false);
  const projects = useQuery(api.projects.list) as ProjectDoc[] | undefined;
  const removeProject = useMutation(api.projects.remove);
  const toggleSaveProject = useMutation(api.projects.toggleSave);
  const renameProject = useMutation(api.projects.rename);
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  const [menuVisible, setMenuVisible] = useState(false);
  const [logoVisible, setLogoVisible] = useState(false);
  const [rightVisible, setRightVisible] = useState(false);
  const [activeNav, setActiveNav] = useState('home');
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [flyingCard, setFlyingCard] = useState<{ fromRect: DOMRect; toPoint: { x: number; y: number }; thumbnailUrl?: string } | null>(null);
  const cardWrapRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevFlipPositions = useRef<Map<string, { top: number; left: number }>>(new Map());
  const pendingFlip = useRef(false);
  const vpRef = useRef<HTMLDivElement>(null);
  const [vpH, setVpH] = useState(0);

  useLayoutEffect(() => {
    const el = vpRef.current; if (!el) return;
    const ro = new ResizeObserver(([entry]) => setVpH(entry.contentRect.height));
    ro.observe(el); setVpH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  const snapshotForFlip = () => {
    prevFlipPositions.current = new Map();
    cardWrapRefs.current.forEach((el, id) => { const r = el.getBoundingClientRect(); prevFlipPositions.current.set(id, { top: r.top, left: r.left }); });
    pendingFlip.current = true;
  };

  useLayoutEffect(() => {
    if (!pendingFlip.current) return;
    pendingFlip.current = false;
    cardWrapRefs.current.forEach((el, id) => {
      const prev = prevFlipPositions.current.get(id); if (!prev) return;
      const curr = el.getBoundingClientRect();
      const dx = prev.left - curr.left, dy = prev.top - curr.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      el.style.transition = 'none'; el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = 'transform 320ms cubic-bezier(0,0,0.2,1)'; el.style.transform = ''; }));
    });
    prevFlipPositions.current = new Map();
  });

  const floorIndex = activeNav === 'home' ? 0 : activeNav === 'saved' ? 1 : 2;
  const floorSliderRef = useRef<HTMLDivElement>(null);
  const sidebarDarkRef = useRef<HTMLDivElement>(null);
  const wordmarkLightRef = useRef<HTMLDivElement>(null);
  const wordmarkDarkRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const prevFloorRef = useRef(floorIndex);

  useEffect(() => {
    if (!vpH) return;
    const floorSlider = floorSliderRef.current, sidebarDark = sidebarDarkRef.current;
    const wLight = wordmarkLightRef.current, wDark = wordmarkDarkRef.current;
    if (!floorSlider || !sidebarDark) return;
    cancelAnimationFrame(rafRef.current);
    const prevFloor = prevFloorRef.current; prevFloorRef.current = floorIndex;
    if (floorIndex !== 1 && prevFloor !== 1) {
      sidebarDark.style.clipPath = 'inset(100% 0 0 0)';
      if (wLight) wLight.style.opacity = '1';
      if (wDark) wDark.style.opacity = '0';
      return;
    }
    const step1 = vpH + 320, step2 = 2 * vpH + 640;
    let lastP = -1, stableFrames = 0;
    const tick = () => {
      const matrix = new DOMMatrix(window.getComputedStyle(floorSlider).transform);
      const p = -matrix.m42;
      let charcoalAmount = p <= step1 ? p / step1 : 1 - (p - step1) / (step2 - step1);
      charcoalAmount = Math.max(0, Math.min(1, charcoalAmount / 0.732051));
      sidebarDark.style.clipPath = `inset(${(1 - charcoalAmount) * 100}% 0 0 0)`;
      if (wLight) wLight.style.opacity = String(1 - charcoalAmount);
      if (wDark) wDark.style.opacity = String(charcoalAmount);
      if (Math.abs(p - lastP) < 0.5) { stableFrames++; if (stableFrames > 4) { const isAtSaved = floorIndex === 1; sidebarDark.style.clipPath = `inset(${isAtSaved ? 0 : 100}% 0 0 0)`; if (wLight) wLight.style.opacity = isAtSaved ? '0' : '1'; if (wDark) wDark.style.opacity = isAtSaved ? '1' : '0'; return; } } else { stableFrames = 0; }
      lastP = p; rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [floorIndex, vpH]);

  const homeProjects = (() => {
    if (!projects) return undefined;
    let list = [...projects];
    if (searchQuery) { const q = searchQuery.toLowerCase(); list = list.filter(p => p.name.toLowerCase().includes(q)); }
    if (activeTab === 'recent') list = list.slice(0, 6);
    return list;
  })();

  const savedProjects = (() => {
    if (!projects) return undefined;
    let list = projects.filter(p => !!p.savedAt);
    if (searchQuery) { const q = searchQuery.toLowerCase(); list = list.filter(p => p.name.toLowerCase().includes(q)); }
    if (activeTab === 'recent') list = list.slice(0, 6);
    return list;
  })();

  const handleSaveProject = (p: ProjectDoc, cardRect: DOMRect) => {
    toggleSaveProject({ projectId: p._id });
    if (!p.savedAt) {
      const savedBtn = document.querySelector('[data-nav="saved"]');
      if (savedBtn) {
        const r = savedBtn.getBoundingClientRect();
        setFlyingCard({ fromRect: cardRect, toPoint: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, thumbnailUrl: p.thumbnailUrl });
      }
    }
  };

  useEffect(() => {
    const t1 = setTimeout(() => setMenuVisible(true), 60);
    const t2 = setTimeout(() => setLogoVisible(true), 190);
    const t3 = setTimeout(() => setRightVisible(true), 380);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  const navItems: Array<{ key: string; icon: React.ReactNode }> = [
    { key: 'home', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12L12 3L21 12" /><path d="M5 10.5V20H9.5V15H14.5V20H19V10.5" /></svg> },
    { key: 'saved', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3H19V21L12 15.5L5 21Z" /></svg> },
    { key: 'explore', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L22 22" /></svg> },
  ];

  const NavButton = ({ item, dark = false }: { item: typeof navItems[0]; dark?: boolean }) => {
    const isActive = item.key === activeNav;
    return (
      <button key={item.key} data-nav={item.key} onClick={() => setActiveNav(item.key)}
        style={{ border: 'none', cursor: 'pointer', background: isActive ? (dark ? 'rgba(232,97,77,0.18)' : 'rgba(232,97,77,0.1)') : 'transparent', color: isActive ? 'var(--coral)' : dark ? 'rgba(252,245,228,0.7)' : 'var(--ink)', padding: '10px 0', borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: 66, fontSize: 9.5, fontFamily: 'var(--font-dmsans)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', outline: isActive ? `1.5px solid rgba(232,97,77,${dark ? '0.35' : '0.28'})` : '1.5px solid transparent', transition: 'background 160ms ease, color 160ms ease, outline-color 160ms ease' }}
      >
        {item.icon}<span>{item.key}</span>
      </button>
    );
  };

  return (
    <main className="relative overflow-hidden" style={{ height: '100vh', background: 'var(--biscuit-lt)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '88px 1fr', height: '100vh', opacity: menuVisible ? 1 : 0, transition: 'opacity 400ms ease' }}>
        {/* Left nav rail */}
        <aside style={{ borderRight: '2px solid rgba(42,32,26,0.22)', background: 'var(--biscuit)', zIndex: 2, position: 'relative', overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', padding: '24px 10px', height: '100%', position: 'relative', zIndex: 1 }}>
            <div style={{ marginBottom: 24, width: 30, transform: 'rotate(186deg)', opacity: 0.85 }}><BarberMascot isStatic color="var(--ink)" /></div>
            {navItems.map(n => <NavButton key={n.key} item={n} />)}
          </div>
          <div ref={sidebarDarkRef} style={{ position: 'absolute', inset: 0, background: '#181b17', borderRight: '2px solid rgba(252,245,228,0.1)', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', padding: '24px 10px', clipPath: 'inset(0 0 100% 0)', zIndex: 2 }}>
            <div style={{ marginBottom: 24, width: 30, transform: 'rotate(186deg)', opacity: 0.75 }}><BarberMascot isStatic color="#fcf5e4" /></div>
            {navItems.map(n => <NavButton key={n.key} item={n} dark />)}
          </div>
        </aside>

        {/* Main content */}
        <div className="min-w-0" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', position: 'relative' }}>
          {/* Top bar — transparent overlay so floor content shows through */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }}>
            <div style={{ padding: '24px 40px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div className={logoVisible ? 'slide-in-left' : 'opacity-0'} style={{ position: 'relative' }}>
                  <div ref={wordmarkLightRef}><InlineWordmark /></div>
                  <div ref={wordmarkDarkRef} style={{ position: 'absolute', inset: 0, opacity: 0 }}><InlineWordmark cream /></div>
                </div>
                <div className={`flex items-center gap-3 ${rightVisible ? 'slide-in-right' : 'opacity-0'}`}>
                  <ProfileMenu onRescan={onRescan} pulse={profilePillPulse} celebratePurchase={celebratePurchase} />
                </div>
              </div>
            </div>
          </div>

          {/* Floor slider */}
          <div ref={vpRef} style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            <div ref={floorSliderRef} style={{ transform: vpH ? `translateY(${floorIndex === 0 ? 0 : floorIndex === 1 ? -(vpH + 320) : -(2 * vpH + 640)}px)` : 'translateY(0)', transition: vpH ? 'transform 486ms cubic-bezier(0.34, 1.08, 0.64, 1)' : 'none', willChange: 'transform' }}>

              {/* Floor 0 — Home */}
              <div className="cozy-scroll" style={{ height: vpH || '100vh', overflowY: 'auto', padding: '56px 40px 80px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32, marginTop: 28 }}>
                  <HomeTitle count={projects?.length} />
                  <div style={{ flex: 1 }} />
                  <div style={{ position: 'relative', width: 248 }}>
                    <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'rgba(42,32,26,0.55)', fontSize: 14, pointerEvents: 'none' }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L22 22" /></svg></span>
                    <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="find a style..." style={{ width: '100%', padding: '10px 14px 10px 38px', border: '1.5px solid var(--search-floor0-border)', borderRadius: 9999, background: 'rgba(42,32,26,0.05)', fontSize: 14, color: 'var(--ink)', fontFamily: 'var(--font-fraunces), Georgia, serif', fontStyle: 'italic', outline: 'none' }} onFocus={e => (e.target.style.borderColor = 'rgba(232,97,77,0.5)')} onBlur={e => (e.target.style.borderColor = document.documentElement.classList.contains('dark') ? 'rgba(255,255,255,0.28)' : 'rgba(42,32,26,0.28)')} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 28, alignItems: 'center' }}>
                  {['all', 'recent'].map(t => <button key={t} onClick={() => setActiveTab(t)} style={{ padding: '7px 17px', border: `1.5px solid ${activeTab === t ? 'rgba(232,97,77,0.55)' : 'rgba(42,32,26,0.28)'}`, background: activeTab === t ? 'rgba(232,97,77,0.08)' : 'transparent', borderRadius: 9999, cursor: 'pointer', fontFamily: 'var(--font-dmsans)', fontWeight: 700, fontSize: 13, color: activeTab === t ? 'var(--coral)' : 'rgba(42,32,26,0.7)', letterSpacing: '0.02em', transition: 'all 160ms ease' }}>{t}</button>)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 28, marginTop: 24 }}>
                  <AddProjectButton onClick={onAdd} isEmpty={projects !== undefined && projects.length === 0} />
                  {homeProjects?.map((p, i) => (
                    <div key={p._id} ref={el => { if (el) cardWrapRefs.current.set(p._id, el); else cardWrapRefs.current.delete(p._id); }} className="grid-settle" style={{ ['--settle-i' as string]: i }}>
                      <ProjectCard project={p} onClick={() => onOpenProject(p)} rotate={[-1.4, 0.8, -0.6, 1.2, -0.8][i % 5]} onDelete={() => { snapshotForFlip(); removeProject({ projectId: p._id }); }} onSave={(cardRect) => handleSaveProject(p, cardRect)} onRename={(name) => renameProject({ projectId: p._id, name })} />
                    </div>
                  ))}
                </div>
                {showScanNow && !(projects && projects.length > 0) && (
                  <div className="mt-8 flex justify-center scan-btn-pop">
                    <BouncyButton onClick={onScanNow} className="btn" style={{ padding: '12px 28px', fontSize: 14, background: 'var(--coral)', color: 'var(--offwhite)', boxShadow: '0 4px 20px -4px rgba(232,97,77,0.4)' }}>✂ Scan now</BouncyButton>
                  </div>
                )}
              </div>

              {/* Gap band: Home → Saved */}
              <div style={{ height: 320, flexShrink: 0, pointerEvents: 'none' }}>
                <svg viewBox="0 0 1440 320" preserveAspectRatio="none" style={{ width: '100%', height: 320, display: 'block' }}>
                  <rect width="1440" height="320" fill="#fcf5e4" />
                  <path d="M0,320 L0,180 C240,70 480,290 720,180 C960,70 1200,290 1440,180 L1440,320 Z" fill="#2b2e27" />
                </svg>
              </div>

              {/* Floor 1 — Saved */}
              <div className="cozy-scroll" style={{ height: vpH || '100vh', overflowY: 'auto', background: isDark ? '#181b17' : undefined, backgroundImage: isDark ? undefined : 'url(/dark_charcoal.png)', backgroundSize: isDark ? undefined : 'cover', backgroundPosition: isDark ? undefined : 'center', padding: '56px 40px 80px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32, marginTop: 28 }}>
                  <SavedTitle count={savedProjects?.length} />
                  <div style={{ flex: 1 }} />
                  <div style={{ position: 'relative', width: 248 }}>
                    <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'rgba(252,245,228,0.55)', fontSize: 14, pointerEvents: 'none' }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L22 22" /></svg></span>
                    <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="find a style..." style={{ width: '100%', padding: '10px 14px 10px 38px', border: '1.5px solid rgba(252,245,228,0.45)', borderRadius: 9999, background: 'rgba(252,245,228,0.08)', fontSize: 14, color: '#fcf5e4', fontFamily: 'var(--font-fraunces), Georgia, serif', fontStyle: 'italic', outline: 'none' }} onFocus={e => (e.target.style.borderColor = 'rgba(232,97,77,0.6)')} onBlur={e => (e.target.style.borderColor = 'rgba(252,245,228,0.45)')} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 28, alignItems: 'center' }}>
                  {['all', 'recent'].map(t => <button key={t} onClick={() => setActiveTab(t)} style={{ padding: '7px 17px', border: `1.5px solid ${activeTab === t ? 'rgba(232,97,77,0.6)' : 'rgba(252,245,228,0.28)'}`, background: activeTab === t ? 'rgba(232,97,77,0.15)' : 'transparent', borderRadius: 9999, cursor: 'pointer', fontFamily: 'var(--font-dmsans)', fontWeight: 700, fontSize: 13, color: activeTab === t ? 'var(--coral)' : 'rgba(252,245,228,0.7)', letterSpacing: '0.02em', transition: 'all 160ms ease' }}>{t}</button>)}
                </div>
                {isSignedIn === false ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 64, gap: 20 }}>
                    <div className="saved-ghost">
                      <svg className="saved-ghost-frame" aria-hidden><rect rx="14" ry="14" fill="none" stroke="rgba(252,245,228,0.3)" strokeWidth="1.5" strokeDasharray="8 7" /></svg>
                      <svg className="saved-ghost-bookmark" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="rgba(212,175,55,0.9)" strokeWidth="2" strokeLinejoin="round" aria-hidden><path d="M5 3H19V21L12 15.5L5 21Z" /></svg>
                      <span className="font-display saved-ghost-caption">sign in to see your keepers</span>
                    </div>
                    <p style={{ margin: 0, maxWidth: 360, textAlign: 'center', fontFamily: 'var(--font-dmsans)', fontSize: 14, lineHeight: 1.55, color: 'rgba(252,245,228,0.55)' }}>Your saved cuts live here. Sign in to bookmark styles and build your collection.</p>
                    <BouncyButton onClick={() => setShowSignIn(true)} className="btn btn-cream" style={{ padding: '11px 26px', fontSize: 13 }}>Sign in</BouncyButton>
                    {showSignIn && <SignInModal onClose={() => setShowSignIn(false)} />}
                  </div>
                ) : savedProjects && savedProjects.length === 0 ? <SavedEmptyState onBrowse={() => setActiveNav('home')} /> : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 28, marginTop: 24 }}>
                    {savedProjects?.map((p, i) => (
                      <div key={p._id} ref={el => { if (el) cardWrapRefs.current.set(p._id, el); else cardWrapRefs.current.delete(p._id); }} className="grid-settle" style={{ ['--settle-i' as string]: i }}>
                        <ProjectCard project={p} onClick={() => onOpenProject(p)} rotate={[-1.4, 0.8, -0.6, 1.2, -0.8][i % 5]} onDelete={() => { snapshotForFlip(); removeProject({ projectId: p._id }); }} onSave={(cardRect) => handleSaveProject(p, cardRect)} onRename={(name) => renameProject({ projectId: p._id, name })} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Gap band: Saved → Explore */}
              {isDark ? (
                <div style={{ height: 320, flexShrink: 0, pointerEvents: 'none', background: '#181b17' }} />
              ) : (
                <div style={{ height: 320, flexShrink: 0, pointerEvents: 'none' }}>
                  <svg viewBox="0 0 1440 320" preserveAspectRatio="none" style={{ width: '100%', height: 320, display: 'block' }}>
                    <rect width="1440" height="320" fill="#2b2e27" />
                    <path d="M0,320 L0,180 C240,70 480,290 720,180 C960,70 1200,290 1440,180 L1440,320 Z" fill="#fcf5e4" />
                  </svg>
                </div>
              )}

              {/* Floor 2 — Explore */}
              <div style={{ height: vpH || '100vh', position: 'relative', background: isDark ? '#181b17' : undefined }}><ExploreFloor /></div>
            </div>
          </div>

          {flyingCard && <FlyingCard fromRect={flyingCard.fromRect} toPoint={flyingCard.toPoint} thumbnailUrl={flyingCard.thumbnailUrl} onDone={() => setFlyingCard(null)} />}
        </div>
      </div>
    </main>
  );
}

/* ─── Dashboard Page ─── */
export default function DashboardPage() {
  const { isSignedIn } = useUser();
  const router = useRouter();
  const { startLoading } = useNavLoading();
  const getOrCreate = useMutation(api.users.getOrCreate);
  const createProject = useMutation(api.projects.create);
  const saveProject = useMutation(api.projects.save);
  const meUser = useQuery(api.users.getMe);
  const allProjects = useQuery(api.projects.list);

  useEffect(() => {
    if (isSignedIn) getOrCreate().catch(err => console.error('[Dashboard] getOrCreate failed:', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  // Detect payment success redirect from Stripe
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      setPaymentSuccess(true);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const needsUsername = isSignedIn && meUser !== undefined && meUser !== null && !meUser.username;

  const [showAuthPopup, setShowAuthPopup] = useState(false);
  const [authVisible, setAuthVisible] = useState(false);
  const [authClosing, setAuthClosing] = useState(false);

  const openAuthPopup = () => {
    setShowAuthPopup(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setAuthVisible(true)));
  };
  const dismissAuthPopup = () => {
    setAuthClosing(true);
    setTimeout(() => { setShowAuthPopup(false); setAuthVisible(false); setAuthClosing(false); }, 320);
  };
  const handleAuthDone = () => {
    setShowAuthPopup(false);
    setAuthVisible(false);
    setAuthClosing(false);
    setShowScanPopup(true);
  };

  const [showScanPopup, setShowScanPopup] = useState(false);
  const [showOutOfTokens, setShowOutOfTokens] = useState(false);
  const [showScanResult, setShowScanResult] = useState(false);
  const [hasScanEver, setHasScanEver] = useState(false);
  const [selfieFlying, setSelfieFlying] = useState<{ url: string } | null>(null);
  const [profilePillPulse, setProfilePillPulse] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pendingProjectId, setPendingProjectId] = useState<Id<'projects'> | null>(null);

  // Auto-open scan popup for new users with no username
  useEffect(() => {
    if (needsUsername) setShowScanPopup(true);
  }, [needsUsername]);

  const handleScanComplete = useCallback(async (
    p: UserHeadProfile,
    sid: string | null,
    url: string | null,
    fromRect?: DOMRect,
    isFirstScan?: boolean,
    splatUrl?: string,
  ) => {
    const profileWithMeasurements = ensureMeasurementSnapshot(p);
    setHasScanEver(true);
    setShowScanPopup(false);

    // Store transient session data for studio to pick up
    if (sid) sessionStorage.setItem('studio_sessionId', sid);
    if (splatUrl) sessionStorage.setItem('studio_splatUrl', splatUrl);

    // Derive the permanent S3 key from sessionId (matches save-scan key path).
    // Only set if S3 upload succeeded — fallback url starts with "data:" if it failed.
    const scanS3Key = sid && url && !url.startsWith('data:') ? `pictures/${sid}/scan.png` : null;

    // Create a Convex project for this scan
    let projectId: Id<'projects'>;
    try {
      projectId = await createProject({ name: generateUniqueCutName(allProjects ?? []) });
      const { imageDataUrl: _i, maskDataUrl: _m, classifierFrames: _c, ...cleanScan } =
        profileWithMeasurements.faceScanData ?? {} as never;
      const profileToSave = {
        ...profileWithMeasurements,
        faceScanData: profileWithMeasurements.faceScanData ? cleanScan : undefined,
      };
      await saveProject({
        projectId,
        lastImageUrl: url ?? undefined,
        lastImageS3Key: scanS3Key ?? undefined,
        thumbnailS3Key: scanS3Key ?? undefined,
        lastProfile: profileToSave,
        lastHairParams: profileWithMeasurements.currentStyle.params,
        lastSplatUrl: splatUrl ?? undefined,
      });
    } catch (err) {
      console.error('[Dashboard] Failed to create project:', err);
      return;
    }

    setPendingProjectId(projectId);
    if (url) setImageUrl(url);

    if (isFirstScan && url) {
      setSelfieFlying({ url });
      return;
    }

    if (url) {
      setShowScanResult(true);
    } else {
      router.push(`/studio/${projectId}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddProject = () => {
    if (!isSignedIn) { openAuthPopup(); return; }
    setShowScanPopup(true);
  };
  const handleOpenProject = (project: ProjectDoc) => {
    startLoading();
    router.push(`/studio/${project._id}`);
  };

  return (
    <>
      <MainMenu
        onAdd={handleAddProject}
        onOpenProject={handleOpenProject}
        showScanNow={!hasScanEver}
        onScanNow={() => { if (!isSignedIn) { openAuthPopup(); return; } setShowScanPopup(true); }}
        onRescan={() => setShowScanPopup(true)}
        profilePillPulse={profilePillPulse}
        celebratePurchase={paymentSuccess}
        isSignedIn={isSignedIn}
      />

      {showScanPopup && (
        <ScanPopup
          onScanComplete={handleScanComplete}
          onDismiss={() => setShowScanPopup(false)}
          onNoTokens={() => setShowOutOfTokens(true)}
          needsUsername={needsUsername}
        />
      )}
      {showOutOfTokens && <PricingPopup outOfTokens onDismiss={() => setShowOutOfTokens(false)} />}

      {showAuthPopup && createPortal(
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 60,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: authVisible && !authClosing ? 'rgba(10,8,6,0.92)' : 'rgba(10,8,6,0)',
            transition: 'background 320ms ease',
          }}
          onClick={dismissAuthPopup}
        >
          <button
            onClick={dismissAuthPopup}
            style={{
              position: 'absolute', top: 24, right: 24,
              width: 36, height: 36, borderRadius: '50%',
              background: 'rgba(255,248,234,0.08)', border: '1px solid rgba(255,248,234,0.16)',
              color: 'rgba(255,248,234,0.55)', cursor: 'pointer', fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 160ms ease, color 160ms ease',
            }}
          >✕</button>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28,
              transform: authVisible && !authClosing ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.97)',
              opacity: authVisible && !authClosing ? 1 : 0,
              transition: 'transform 300ms cubic-bezier(.2,.85,.2,1), opacity 280ms ease',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <p style={{
                fontFamily: 'var(--font-jetbrains), monospace',
                fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.16em',
                color: 'rgba(255,248,234,0.45)', margin: '0 0 10px',
              }}>
                sign in to continue
              </p>
              <h2 style={{
                fontFamily: 'var(--font-fraunces), Georgia, serif',
                fontSize: 'clamp(2rem, 4vw, 2.8rem)', fontWeight: 900,
                color: 'var(--cream)', letterSpacing: '-0.03em', lineHeight: 0.95, margin: 0,
              }}>
                Start exploring.
              </h2>
            </div>
            <SignUpWidget
              onEnter={handleAuthDone}
              large
              redirectUrlComplete="/dashboard"
            />
          </div>
        </div>,
        document.body
      )}

      {showScanResult && imageUrl && (
        <ScanResultPopup
          imageUrl={imageUrl}
          onContinue={() => {
            setShowScanResult(false);
            if (pendingProjectId) router.push(`/studio/${pendingProjectId}`);
          }}
        />
      )}

      {selfieFlying && imageUrl && (
        <SelfieFlightOverlay
          imageUrl={imageUrl}
          onDone={() => {
            setSelfieFlying(null);
            setProfilePillPulse(true);
            setTimeout(() => setProfilePillPulse(false), 800);
            setShowScanResult(true);
          }}
        />
      )}
    </>
  );
}
