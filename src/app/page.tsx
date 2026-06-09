'use client';

import { HairMeasurementBBox, HairParams, UserHeadProfile } from '@/types';
import { buildHairMeasurementSnapshot, ensureMeasurementSnapshot } from '@/lib/hairMeasurementSnapshot';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useClerk, useUser } from '@clerk/nextjs';
import { useSignIn, useSignUp } from '@clerk/nextjs/legacy';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { Id } from '@convex/_generated/dataModel';

import EditPanel from '@/components/EditPanel';
import { WaitlistPage } from '@/components/WaitlistPage';
import Image from 'next/image';
import Link from 'next/link';
import { useDemoFacelift } from '@/hooks/useDemoFacelift';
import dynamic from 'next/dynamic';
import { mockUserHeadProfile } from '@/data/mockProfile';
import { useSmirk } from '@/hooks/useSmirk';

const HairScene  = dynamic(() => import('@/components/HairScene'),  { ssr: false });
const ScanCamera = dynamic(() => import('@/components/ScanCamera'), { ssr: false });
const HairRecommendationsBar = dynamic(() => import('@/components/HairRecommendationsBar'), { ssr: false });

type AppState = 'loading' | 'landing' | 'home' | 'scan' | 'hairEditLoop' | '3d';
type RawHairBBox = Omit<HairMeasurementBBox, 'width' | 'height' | 'depth'>;

/* ─────────────── Barber Mascot SVG ─────────────── */
function BarberMascot({ snap = false, size = 'full', isStatic = false, color = '#2a201a' }: { snap?: boolean; size?: 'full' | 'sm'; isStatic?: boolean; color?: string }) {
  const bladeClass = isStatic ? '' : snap ? 'scissor-snap-left' : 'scissor-blade-left';
  const bladeClassR = isStatic ? '' : snap ? 'scissor-snap-right' : 'scissor-blade-right';
  return (
    <svg
      viewBox="0 0 200 360"
      xmlns="http://www.w3.org/2000/svg"
      className={`${size === 'sm' ? 'w-full h-auto' : 'w-full h-auto'} drop-shadow-lg scissor-mascot`}
    >
      <line x1="94" y1="188" x2="58" y2="266" stroke={color} strokeWidth="13" strokeLinecap="round" />
      <line x1="106" y1="188" x2="142" y2="266" stroke={color} strokeWidth="13" strokeLinecap="round" />
      <circle cx="52" cy="300" r="34" fill="none" stroke={color} strokeWidth="14" />
      <circle cx="148" cy="300" r="34" fill="none" stroke={color} strokeWidth="14" />
      <g className={bladeClass}>
        <path d="M 108 172 L 88 188 L 32 28 L 48 22 Z" fill={color} stroke={color} strokeWidth="4" strokeLinejoin="round" />
      </g>
      <g className={bladeClassR}>
        <path d="M 92 172 L 112 188 L 168 28 L 152 22 Z" fill={color} stroke={color} strokeWidth="4" strokeLinejoin="round" />
      </g>
      <circle cx="100" cy="180" r="13" fill={color} />
    </svg>
  );
}

/* ─────────────── Inline wordmark (✂ Shape Up) ─────────────── */
function InlineWordmark({ cream = false, small = false }: { cream?: boolean; small?: boolean }) {
  const color = cream ? 'text-[var(--cream)]' : 'text-[var(--ink)]';
  const mascotColor = cream ? 'rgba(245,241,234,0.88)' : '#2a201a';
  const textSize = small ? 'text-[13px]' : 'text-[18px]';
  return (
    <div className={`wordmark-inline ${color} ${textSize}`}>
      <span style={{ width: small ? 20 : 28, display: 'inline-block' }}>
        <BarberMascot color={mascotColor} />
      </span>
      <span style={{ fontWeight: 700, letterSpacing: '0.06em' }}>
        Shape <span style={{ display: 'inline' }}>Up</span>
      </span>
    </div>
  );
}

/* ─────────────── Bouncy Button wrapper ─────────────── */
function BouncyButton({
  onClick,
  className = '',
  style,
  disabled,
  children,
}: {
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [bouncing, setBouncing] = useState(false);
  const handleClick = () => {
    if (disabled) return;
    setBouncing(true);
    setTimeout(() => setBouncing(false), 400);
    onClick?.();
  };
  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={`${className} ${bouncing ? 'btn-bouncing' : ''} transition-transform hover:scale-[1.04] active:scale-95`}
      style={style}
    >
      {children}
    </button>
  );
}

/* ─────────────── Loading Screen ─────────────── */
const LD_W = 600, LD_H = 440, LD_R = 32, LD_M = 24;
const LD_SVG_W = LD_W + LD_M * 2, LD_SVG_H = LD_H + LD_M * 2;
const LD_PERIM = 2 * (LD_W + LD_H) + (2 * Math.PI - 8) * LD_R;
const LD_HALF_PERIM = LD_PERIM / 2;
const LD_DOT_OFFSET = 12;
const LD_SW = 5;
const LOAD_DURATION = 3000;

function getRoundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const cx = x + w / 2;
  return [
    `M ${cx} ${y}`,
    `H ${x + w - r}`,
    `A ${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `V ${y + h - r}`,
    `A ${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
    `H ${x + r}`,
    `A ${r} ${r} 0 0 1 ${x} ${y + h - r}`,
    `V ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    `Z`,
  ].join(' ');
}

function getRoundedRectPathCCW(x: number, y: number, w: number, h: number, r: number): string {
  const cx = x + w / 2;
  return [
    `M ${cx} ${y}`,
    `H ${x + r}`,
    `A ${r} ${r} 0 0 0 ${x} ${y + r}`,
    `V ${y + h - r}`,
    `A ${r} ${r} 0 0 0 ${x + r} ${y + h}`,
    `H ${x + w - r}`,
    `A ${r} ${r} 0 0 0 ${x + w} ${y + h - r}`,
    `V ${y + r}`,
    `A ${r} ${r} 0 0 0 ${x + w - r} ${y}`,
    `H ${cx}`,
  ].join(' ');
}

function LoadingScreen({ onDone, ready }: { onDone: () => void; ready: boolean }) {
  const [done, setDone] = useState(false);
  const [displayedProgress, setDisplayedProgress] = useState(0);
  const displayedRef = useRef(0);
  const isDoneRef = useRef(false);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const minElapsedRef = useRef(false);
  const completedRef = useRef(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const complete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    isDoneRef.current = true;
    setDone(true);
    setTimeout(() => onDoneRef.current(), 650);
  }, []);

  useEffect(() => {
    const tick = (ts: number) => {
      if (!startRef.current) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const rawT = Math.min(elapsed / LOAD_DURATION, 1);
      // Ease-out expo: fast at start, decelerates near end, caps at 88% until fully done
      const eased = rawT === 1 ? 0.88 : (1 - Math.pow(2, -10 * rawT)) * 0.88;
      const target = isDoneRef.current ? 1 : eased;
      const lerpRate = isDoneRef.current ? 0.1 : 0.05;
      displayedRef.current += (target - displayedRef.current) * lerpRate;
      setDisplayedProgress(displayedRef.current);
      if (displayedRef.current < 0.999) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  // Minimum animation gate — only complete once min time elapsed AND landing assets are ready
  useEffect(() => {
    const t = setTimeout(() => {
      minElapsedRef.current = true;
      if (readyRef.current) complete();
    }, LOAD_DURATION);
    return () => clearTimeout(t);
  }, [complete]);

  // Trigger completion if assets finish loading after the min time has already elapsed
  useEffect(() => {
    if (ready && minElapsedRef.current) complete();
  }, [ready, complete]);

  const pathCW = getRoundedRectPath(LD_M, LD_M, LD_W, LD_H, LD_R);
  const pathCCW = getRoundedRectPathCCW(LD_M, LD_M, LD_W, LD_H, LD_R);
  const arcLen = displayedProgress * (LD_HALF_PERIM - LD_DOT_OFFSET);

  return (
    <main className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'var(--biscuit)' }}>
      <div
        className="flex flex-col items-center gap-4"
        style={{
          position: 'relative',
          transition: 'transform 650ms cubic-bezier(.85,0,1,1)',
          transform: done ? 'translateY(-100vh)' : 'translateY(0)',
        }}
      >
        <svg
          style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: LD_SVG_W, height: LD_SVG_H, pointerEvents: 'none' }}
          viewBox={`0 0 ${LD_SVG_W} ${LD_SVG_H}`}
        >
          <path d={pathCW} fill="none" stroke="rgba(214,60,47,0.1)" strokeWidth={LD_SW} />
          <path
            d={pathCW}
            fill="none"
            stroke="var(--tomato)"
            strokeWidth={LD_SW}
            strokeLinecap="round"
            strokeDasharray={`${arcLen} ${LD_PERIM}`}
            strokeDashoffset={LD_DOT_OFFSET}
          />
          <path
            d={pathCCW}
            fill="none"
            stroke="var(--tomato)"
            strokeWidth={LD_SW}
            strokeLinecap="round"
            strokeDasharray={`${arcLen} ${LD_PERIM}`}
            strokeDashoffset={LD_DOT_OFFSET}
          />
        </svg>

        <div style={{ width: 56, transform: 'rotate(186deg)' }}>
          <BarberMascot snap />
        </div>
        <h1
          className="type-chonk text-[var(--ink)] select-none text-center"
          style={{ fontSize: 'clamp(4rem, 13vw, 8rem)', lineHeight: 0.9 }}
        >
          SHaPE
          <br />
          <em style={{ color: 'var(--tomato)' }}>UP</em>
        </h1>
      </div>
    </main>
  );
}

/* ─────────────── Profile Menu ─────────────── */
function ProfileMenu({ onRescan, onSignIn, pulse = false, celebratePurchase = false }: { onRescan: () => void; onSignIn: () => void; pulse?: boolean; celebratePurchase?: boolean }) {
  const { user: clerkUser, isSignedIn } = useUser();
  const { signOut } = useClerk();
  const userQuery = useQuery(api.users.getMe);
  const [open, setOpen] = useState(false);
  const [bouncing, setBouncing] = useState(false);
  const [swallowing, setSwallowing] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsOriginRect, setSettingsOriginRect] = useState<DOMRect | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [displayCredits, setDisplayCredits] = useState<number | null>(null);
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

  // Auto-open and animate counter after successful purchase
  useEffect(() => {
    if (!celebratePurchase) return;
    setTimeout(() => setOpen(true), 300);
    animatingRef.current = true;
    setDisplayCredits(0);
  }, [celebratePurchase]);

  useEffect(() => {
    if (!animatingRef.current || user?.credits == null) return;
    animatingRef.current = false;
    const target = user.credits;
    const duration = 1400;
    const steps = 48;
    let step = 0;
    const interval = setInterval(() => {
      step++;
      const eased = 1 - Math.pow(1 - step / steps, 3);
      setDisplayCredits(Math.round(eased * target));
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
      <BouncyButton onClick={onSignIn} className="btn" style={{ padding: '9px 18px', fontSize: 11, background: 'var(--coral)', color: 'var(--offwhite)', border: 'none' }}>
        Sign in
      </BouncyButton>
    );
  }

  const username = user?.username ?? clerkUser?.firstName ?? clerkUser?.emailAddresses?.[0]?.emailAddress?.split('@')[0] ?? 'You';

  const handleToggle = () => {
    if (!open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.top, right: window.innerWidth - rect.right });
    }
    setOpen(o => !o);
  };

  const handleOpenSettings = () => {
    if (containerRef.current) {
      setSettingsOriginRect(containerRef.current.getBoundingClientRect());
    }
    setShowSettings(true);
  };

  const handleSettingsDismiss = () => {
    setShowSettings(false);
    setTimeout(() => setOpen(false), 500);
  };

  return (
    <div
      id="profile-menu-pill"
      ref={containerRef}
      className={`relative ${bouncing ? 'profile-pill-bounce' : ''} ${swallowing ? 'profile-pill-swallow' : ''}`}
      style={{ width: 176, height: 36, flexShrink: 0 }}
    >
      {menuPos && createPortal(
        <div style={{
          position: 'fixed',
          top: menuPos.top,
          right: menuPos.right,
          width: open ? 380 : 176,
          maxHeight: open ? '600px' : '36px',
          background: 'var(--cream)',
          border: '1px solid rgba(42,32,26,0.12)',
          backdropFilter: 'blur(8px)',
          borderRadius: open ? 22 : 40,
          boxShadow: open ? '0 20px 60px -12px rgba(0,0,0,0.28)' : 'none',
          overflow: 'hidden',
          zIndex: showPricing ? 10 : 9999,
          pointerEvents: showPricing ? 'none' : 'auto',
          transition: 'width 340ms cubic-bezier(.08,.82,.17,1), max-height 340ms cubic-bezier(.08,.82,.17,1), border-radius 340ms cubic-bezier(.08,.82,.17,1), box-shadow 300ms ease',
        }}>
          {/* Pill header */}
          <button
            onClick={handleToggle}
            className="flex items-center gap-2 w-full"
            style={{ cursor: 'pointer', background: 'none', border: 'none', padding: '8px 14px', height: 36 }}
          >
            <span className="font-sans text-[14px] flex-1 text-left" style={{ fontWeight: 600, color: 'var(--ink)' }}>
              {username}
            </span>
            <svg
              width="10" height="10" viewBox="0 0 10 10" fill="none"
              style={{ color: 'var(--ink)', opacity: 0.7, transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 280ms ease', flexShrink: 0 }}
            >
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* Content — opacity only, width+height are handled by the parent */}
          <div style={{
            opacity: open ? 1 : 0,
            pointerEvents: open ? 'auto' : 'none',
            transition: open ? 'opacity 200ms 160ms ease' : 'opacity 100ms ease',
          }}>
            <div className="flex flex-col gap-5" style={{ padding: '8px 22px 24px' }}>
              <div className="border-t border-dashed border-[var(--char)]/15 pt-5 flex flex-col gap-3">
                <div className="tokens-widget">
                  <div className="tokens-widget__row">
                    <span className="tokens-widget__label">Tokens</span>
                    <span className="tokens-widget__count">{displayCredits !== null ? displayCredits : (user?.credits ?? 0)}</span>
                  </div>
                  <BouncyButton
                    onClick={() => { setShowPricing(true); setOpen(false); }}
                    className="btn-tokens-cta w-full"
                  >
                    <span className="btn-tokens-cta__shimmer" />
                    <span className="btn-tokens-cta__text">Get more tokens</span>
                  </BouncyButton>
                </div>
              </div>

              <div className="border-t border-dashed border-[var(--char)]/15 pt-3 flex items-center justify-between">
                <BouncyButton
                  onClick={handleOpenSettings}
                  className="font-sans text-[var(--smoke)] hover:text-[var(--ink)] transition-colors"
                  style={{ background: 'none', border: 'none', padding: '4px 2px', lineHeight: 1 }}
                >
                  <span style={{ fontSize: 32, display: 'block', lineHeight: 1 }}>⚙</span>
                </BouncyButton>
                <BouncyButton
                  onClick={() => { setOpen(false); signOut(); }}
                  className="font-sans text-[15px] uppercase tracking-wider text-[var(--smoke)] hover:text-[var(--tomato)] transition-colors"
                  style={{ background: 'none', border: 'none', paddingRight: 2 }}
                >
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
        <SettingsPopup
          onDismiss={handleSettingsDismiss}
          onRescan={() => { setOpen(false); onRescan(); }}
          originRect={settingsOriginRect}
        />
      )}
    </div>
  );
}

/* ─────────────── Scan Now Popup ─────────────── */
function ScanNowPopup({
  onLetsDo,
  onDismiss,
}: { onLetsDo: () => void; onDismiss: () => void }) {
  const [show, setShow] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShow(true), 16);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    setClosing(true);
    setTimeout(onDismiss, 420);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      style={{
        background: show && !closing ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)',
        transition: 'background 400ms ease',
      }}
    >
      <div
        style={{
          transition: 'transform 380ms cubic-bezier(.2,.85,.2,1)',
          transform: closing ? 'translateY(100vh)' : show ? 'translateY(0)' : 'translateY(-100vh)',
        }}
      >
        <div
          className="relative rounded-3xl flex flex-col items-center gap-5"
          style={{
            background: 'var(--cream)',
            border: '1px solid rgba(42,32,26,0.1)',
            boxShadow: '0 30px 80px -20px rgba(0,0,0,0.45)',
            minWidth: 380,
            padding: '44px 44px 40px',
          }}
        >
          <button
            onClick={dismiss}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-[var(--smoke)] hover:text-[var(--ink)] hover:bg-[var(--biscuit)] transition-all text-sm"
          >
            ✕
          </button>

          <div style={{ width: 52, transform: 'rotate(186deg)' }}>
            <BarberMascot />
          </div>
          <h2 className="font-display italic text-[var(--ink)] text-center" style={{ fontWeight: 600, fontSize: 28 }}>
            Scan now!
          </h2>
          <p className="font-sans text-[var(--smoke)] text-center leading-snug" style={{ fontSize: 15 }}>
            Drop in the chair and start styling yourself in 3D!
          </p>
          <BouncyButton
            onClick={onLetsDo}
            className="btn btn-tomato w-full"
            style={{
              padding: '20px 48px',
              fontSize: 26,
              fontFamily: 'var(--font-fraunces), Georgia, serif',
              fontVariationSettings: "'SOFT' 100, 'WONK' 0, 'opsz' 144",
              fontWeight: 900,
              letterSpacing: '-0.02em',
            }}
          >
            Take Picture
          </BouncyButton>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Scan Popup — organic loading steps ─────── */
// Each step is either a fill animation {to, ms} or a stall {hold}.
// Bars run sequentially: each bar starts only after the previous one finishes.
// Bar 4 (holdAt88) stops at 88% and waits until facelift returns, then all bars complete.
type BarSegment = { to: number; ms: number } | { hold: number };

const SCAN_STEPS: { label: string; holdAt88: boolean; segments: BarSegment[] }[] = [
  {
    label: 'Scanning geometry', holdAt88: false,
    segments: [
      { to: 28, ms: 820 },  { hold: 1100 },
      { to: 64, ms: 1050 }, { hold: 750 },
      { to: 100, ms: 880 },
    ],
  },
  {
    label: 'Mapping features', holdAt88: false,
    segments: [
      { to: 16, ms: 900 },  { hold: 2300 },
      { to: 44, ms: 1450 }, { hold: 1500 },
      { to: 78, ms: 1550 }, { hold: 1000 },
      { to: 100, ms: 1050 },
    ],
  },
  {
    label: 'Generating mesh', holdAt88: false,
    segments: [
      { to: 11, ms: 950 },  { hold: 2900 },
      { to: 34, ms: 1650 }, { hold: 1900 },
      { to: 62, ms: 1900 }, { hold: 1600 },
      { to: 86, ms: 1400 }, { hold: 650 },
      { to: 100, ms: 950 },
    ],
  },
  {
    label: 'Building model', holdAt88: true,
    segments: [
      { to: 19, ms: 1150 }, { hold: 3600 },
      { to: 47, ms: 2050 }, { hold: 2700 },
      { to: 88, ms: 2900 },
    ],
  },
];

// Fills fast, decelerates sharply — snappier than symmetric easeInOut
function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function OrganicBar({ label, active = false, segments, holdAt88 = false, complete = false, onComplete }: {
  label: string; active?: boolean; segments: BarSegment[]; holdAt88?: boolean; complete?: boolean; onComplete?: () => void;
}) {
  const [visible, setVisible]       = useState(false);
  const [fillPct, setFillPct]       = useState(0);
  const [completing, setCompleting] = useState(false);
  const rafRef       = useRef<number>(0);
  const holdRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepRef      = useRef(0);
  const stepStartRef = useRef(0);
  const fromPctRef   = useRef(0);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (active) setVisible(true);
  }, [active]);

  useEffect(() => {
    // Skip animation if already completed (e.g. facelift finished before this bar started)
    if (!visible || completedRef.current) return;
    stepRef.current = 0;
    stepStartRef.current = performance.now();
    fromPctRef.current = 0;

    const advance = (now: number) => {
      const seg = segments[stepRef.current];
      if (!seg) return;

      if ('hold' in seg) {
        holdRef.current = setTimeout(() => {
          stepRef.current++;
          stepStartRef.current = performance.now();
          rafRef.current = requestAnimationFrame(advance);
        }, seg.hold);
        return;
      }

      const elapsed = now - stepStartRef.current;
      const t = Math.min(elapsed / seg.ms, 1);
      const pct = fromPctRef.current + easeOut(t) * (seg.to - fromPctRef.current);
      setFillPct(pct);

      if (t >= 1) {
        fromPctRef.current = seg.to;
        stepRef.current++;
        stepStartRef.current = now;
        if (stepRef.current < segments.length) {
          rafRef.current = requestAnimationFrame(advance);
        } else if (!holdAt88 && !completedRef.current) {
          // Natural completion for non-holding bars — trigger next bar
          completedRef.current = true;
          onCompleteRef.current?.();
        }
      } else {
        rafRef.current = requestAnimationFrame(advance);
      }
    };

    rafRef.current = requestAnimationFrame(advance);
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (holdRef.current) clearTimeout(holdRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!complete) return;
    // Facelift returned — cancel any in-progress animation and jump to 100%
    cancelAnimationFrame(rafRef.current);
    if (holdRef.current) clearTimeout(holdRef.current);
    completedRef.current = true;
    setVisible(true);
    setCompleting(true);
    setFillPct(100);
    onCompleteRef.current?.();
  }, [complete]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 5, width: '100%',
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(10px)',
      transition: 'opacity 400ms ease, transform 400ms ease',
    }}>
      <span style={{ fontFamily: 'var(--font-dmsans)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,248,234,0.55)', fontWeight: 500 }}>
        {label}
      </span>
      <div style={{ height: 11, borderRadius: 9999, background: 'rgba(42,32,26,0.1)', overflow: 'hidden', position: 'relative' }}>
        <div className="organic-bar-fill" style={{
          width: `${fillPct}%`,
          transition: completing ? 'width 700ms ease-out' : 'none',
        }} />
      </div>
    </div>
  );
}

type ScanPhase = 'username' | 'camera' | 'verify' | 'processing';

/* ─────────────── Letter-by-letter fade ─────────────── */
function LetterFade({ text, startDelay = 0, charDelay = 26 }: {
  text: string; startDelay?: number; charDelay?: number;
}) {
  return (
    <>
      {text.split('').map((char, i) => (
        <span
          key={i}
          style={{
            display: 'inline',
            opacity: 0,
            animation: 'letter-fade-in 80ms ease forwards',
            animationDelay: `${startDelay + i * charDelay}ms`,
          }}
        >
          {char === ' ' ? ' ' : char}
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

/* ─────────────── Expanded Plan Card (used by PricingPopup) ─────────────── */
function ExpandedPlanCard({
  plan,
  loading,
  onBuy,
  staggerDelay,
}: {
  plan: { readonly id: string; readonly label: string; readonly price: string; readonly featured: boolean };
  loading: string | null;
  onBuy: (id: string) => void;
  staggerDelay: number;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 16);
    return () => clearTimeout(t);
  }, []);

  const springEase = 'cubic-bezier(0.34, 1.15, 0.64, 1)';

  return (
    <div
      style={{
        flex: '1 1 0',
        minWidth: 0,
        transform: ready ? 'scale(1)' : 'scale(0)',
        opacity: ready ? 1 : 0,
        transformOrigin: 'center',
        pointerEvents: ready ? 'auto' : 'none',
        transition: `transform 540ms ${springEase} ${staggerDelay}ms, opacity 300ms ease ${staggerDelay + 180}ms`,
      }}
    >
      <BouncyButton
        onClick={() => onBuy(plan.id)}
        disabled={loading === plan.id}
        className={`rounded-2xl w-full ${plan.featured ? 'btn-tomato' : 'btn-cream'}`}
        style={{
          border: plan.featured ? 'none' : '1px solid rgba(42,32,26,0.12)',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}
      >
        <div className="text-left">
          <div className="font-sans font-semibold" style={{ fontSize: 15 }}>{plan.label}</div>
          {plan.featured && (
            <div className="font-mono opacity-75 mt-0.5" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Most popular
            </div>
          )}
        </div>
        <div className="font-display italic" style={{ fontSize: 26, fontWeight: 700, marginTop: 16 }}>
          {loading === plan.id ? '…' : plan.price}
        </div>
      </BouncyButton>
    </div>
  );
}

/* ─────────────── Settings Popup ─────────────── */
function SettingsPopup({ onDismiss, onRescan, originRect }: {
  onDismiss: () => void;
  onRescan: () => void;
  originRect: DOMRect;
}) {
  const userQuery = useQuery(api.users.getMe);
  const setUsernameMutation = useMutation(api.users.setUsername);
  const [phase, setPhase] = useState<'entering' | 'open' | 'closing'>('entering');
  const [usernameValue, setUsernameValue] = useState(userQuery?.username ?? '');
  const [usernameError, setUsernameError] = useState('');
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameSaved, setUsernameSaved] = useState(false);

  const PANEL_W = 580;
  const PANEL_H = 540;

  useEffect(() => {
    // Two rAFs so the 'entering' (origin) state paints before transitioning
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setPhase('open')));
    return () => cancelAnimationFrame(id);
  }, []);

  const dismiss = () => {
    setPhase('closing');
    setTimeout(onDismiss, 270);
  };

  const handleSaveUsername = async () => {
    if (usernameValue.trim().length < 2) return;
    setUsernameError('');
    setUsernameLoading(true);
    try {
      await setUsernameMutation({ username: usernameValue.trim() });
      setUsernameSaved(true);
      setTimeout(() => setUsernameSaved(false), 2000);
    } catch (err) {
      setUsernameError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setUsernameLoading(false);
    }
  };

  const handleRescan = () => {
    setPhase('closing');
    setTimeout(() => { onDismiss(); onRescan(); }, 270);
  };

  const isOpen = phase === 'open';

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const centerLeft = (vw - PANEL_W) / 2;
  const centerTop  = (vh - PANEL_H) / 2;

  const lerpEase = 'cubic-bezier(0.32, 0.72, 0, 1)';
  const lerpDur  = isOpen ? '480ms' : '240ms';
  const panelTransition = phase === 'entering'
    ? 'none'
    : `top ${lerpDur} ${lerpEase}, left ${lerpDur} ${lerpEase}, width ${lerpDur} ${lerpEase}, height ${lerpDur} ${lerpEase}, border-radius ${lerpDur} ${lerpEase}, box-shadow 300ms ease`;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0"
        style={{
          zIndex: 59,
          background: 'rgba(0,0,0,0.55)',
          opacity: isOpen ? 1 : 0,
          transition: 'opacity 320ms ease',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
        onClick={dismiss}
      />

      {/* Panel — morphs from origin rect to center */}
      <div
        style={{
          position: 'fixed',
          zIndex: 60,
          top:    isOpen ? centerTop  : originRect.top,
          left:   isOpen ? centerLeft : originRect.left,
          width:  isOpen ? PANEL_W    : originRect.width,
          height: isOpen ? PANEL_H    : originRect.height,
          borderRadius: isOpen ? 24 : 18,
          overflow: 'hidden',
          background: 'var(--cream)',
          border: '1px solid rgba(42,32,26,0.1)',
          boxShadow: isOpen
            ? '0 32px 90px -16px rgba(0,0,0,0.5)'
            : '0 20px 50px -12px rgba(0,0,0,0.3)',
          transition: panelTransition,
        }}
      >
        {/* Content — fades in once panel reaches center, fades out immediately on close */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            padding: '48px 52px 44px',
            display: 'flex',
            flexDirection: 'column',
            gap: 28,
            overflow: 'auto',
            opacity: isOpen ? 1 : 0,
            transition: isOpen ? 'opacity 180ms 280ms ease' : 'opacity 100ms ease',
          }}
        >
          {/* Close button */}
          <button
            onClick={dismiss}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-[var(--smoke)] hover:text-[var(--ink)] hover:bg-[var(--biscuit)] transition-all text-sm"
          >
            ✕
          </button>

          <h2 className="font-display italic text-[var(--ink)]" style={{ fontWeight: 600, fontSize: 30 }}>
            Settings
          </h2>

          {/* Username section */}
          <div className="flex flex-col gap-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--smoke)]">Username</span>
            <div className="flex gap-3">
              <input
                type="text"
                value={usernameValue}
                onChange={e => { setUsernameValue(e.target.value); setUsernameError(''); setUsernameSaved(false); }}
                placeholder="your username"
                className="flex-1 font-sans text-[15px] text-[var(--ink)] rounded-xl px-4 py-3"
                style={{
                  background: 'var(--biscuit)',
                  border: usernameError ? '1.5px solid var(--tomato)' : '1.5px solid transparent',
                  outline: 'none',
                }}
              />
              <BouncyButton
                onClick={handleSaveUsername}
                disabled={usernameLoading || usernameValue.trim().length < 2}
                className="btn-ink font-sans text-[13px]"
                style={{ padding: '10px 20px', opacity: usernameLoading || usernameValue.trim().length < 2 ? 0.45 : 1 }}
              >
                {usernameSaved ? '✓ Saved' : usernameLoading ? '…' : 'Save'}
              </BouncyButton>
            </div>
            {usernameError && (
              <span className="font-sans text-[13px] text-[var(--tomato)]">{usernameError}</span>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-dashed border-[var(--char)]/15" />

          {/* Rescan section */}
          <div className="flex flex-col gap-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--smoke)]">3D Scan</span>
            <div className="flex items-center justify-between gap-4">
              <p className="font-sans text-[14px] text-[var(--smoke)] leading-snug" style={{ flex: 1 }}>
                Take a new photo to rebuild your 3D head model from scratch.
              </p>
              <BouncyButton
                onClick={handleRescan}
                className="btn btn-cream"
                style={{ padding: '12px 24px', fontSize: 14, fontWeight: 700, flexShrink: 0 }}
              >
                ✂ Rescan
              </BouncyButton>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

/* ─────────────── Pricing Popup ─────────────── */
function PricingPopup({ onDismiss }: { onDismiss: () => void }) {
  const { isSignedIn } = useUser();
  const [closing, setClosing] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  // 0 = compact, 1 = compact fading + container expanding, 2 = expanded cards growing in
  const [expandPhase, setExpandPhase] = useState<0 | 1 | 2>(0);

  const dismiss = () => {
    setClosing(true);
    setTimeout(onDismiss, 320);
  };

  useEffect(() => {
    const t1 = setTimeout(() => setExpandPhase(1), 480);
    const t2 = setTimeout(() => setExpandPhase(2), 700);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const PLANS = [
    { id: 'starter',  label: '20 haircut generations',       price: '$1.99',  featured: false },
    { id: 'popular',  label: '60 haircut generations',       price: '$4.99',  featured: true  },
    { id: 'lifetime', label: '500 haircut generations',      price: '$14.99', featured: false },
  ] as const;

  const handleBuy = async (planId: string) => {
    if (!isSignedIn) return;
    if (loading) return;
    setLoading(planId);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      });
      const data = await res.json() as { url?: string };
      if (data.url) window.location.href = data.url;
    } finally { setLoading(null); }
  };

  const ease = 'cubic-bezier(0.4, 0, 0.2, 1)';
  const dur = '620ms';
  const containerExpanded = expandPhase >= 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }}>
      <div className={closing ? 'popup-out' : 'popup-in'}>
        <div
          className="relative rounded-3xl flex flex-col items-center gap-5"
          style={{
            background: 'var(--cream)',
            border: '1px solid rgba(42,32,26,0.1)',
            boxShadow: '0 30px 80px -20px rgba(0,0,0,0.45)',
            width: containerExpanded ? 'min(80vw, 920px)' : 360,
            padding: containerExpanded ? '44px 48px 48px' : '44px 40px 40px',
            transition: `width ${dur} ${ease}, padding ${dur} ${ease}`,
          }}
        >
          <button
            onClick={dismiss}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-[var(--smoke)] hover:text-[var(--ink)] hover:bg-[var(--biscuit)] transition-all text-sm"
          >
            ✕
          </button>
          <div style={{ width: 48, transform: 'rotate(186deg)' }}>
            <BarberMascot />
          </div>
          <div className="text-center">
            <h2
              className="font-display italic text-[var(--ink)]"
              style={{ fontWeight: 600, fontSize: containerExpanded ? 30 : 26, transition: `font-size ${dur} ${ease}` }}
            >
              Top up your cuts
            </h2>
            <p
              className="font-sans text-[var(--smoke)] mt-1"
              style={{ fontSize: containerExpanded ? 16 : 14, transition: `font-size ${dur} ${ease}` }}
            >
              Stack tokens and keep the fresh cuts coming.
            </p>
          </div>

          {/* Compact stacked cards — fade out on expansion */}
          {expandPhase < 2 && (
            <div
              className="flex flex-col gap-3 w-full"
              style={{
                opacity: expandPhase === 0 ? 1 : 0,
                transition: 'opacity 200ms ease',
                pointerEvents: expandPhase === 0 ? 'auto' : 'none',
              }}
            >
              {PLANS.map(plan => (
                <BouncyButton
                  key={plan.id}
                  onClick={() => handleBuy(plan.id)}
                  disabled={loading === plan.id}
                  className={`w-full flex items-center justify-between rounded-2xl px-5 py-4 ${plan.featured ? 'btn-tomato' : 'btn-cream'}`}
                  style={{ border: plan.featured ? 'none' : '1px solid rgba(42,32,26,0.12)' }}
                >
                  <div className="text-left">
                    <div className="font-sans font-semibold" style={{ fontSize: 14 }}>{plan.label}</div>
                    {plan.featured && (
                      <div className="font-mono opacity-75 mt-0.5" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Most popular</div>
                    )}
                  </div>
                  <div className="font-display italic" style={{ fontSize: 22, fontWeight: 700 }}>
                    {loading === plan.id ? '…' : plan.price}
                  </div>
                </BouncyButton>
              ))}
            </div>
          )}

          {/* Expanded side-by-side cards — each grows from scale(0) to scale(1) with stagger */}
          {expandPhase === 2 && (
            <div className="flex flex-row w-full" style={{ gap: 12 }}>
              {PLANS.map((plan, i) => (
                <ExpandedPlanCard
                  key={plan.id}
                  plan={plan}
                  loading={loading}
                  onBuy={handleBuy}
                  staggerDelay={i * 90}
                />
              ))}
            </div>
          )}

          {/* Perks banner — revealed on expand */}
          <div
            style={{
              width: '100%',
              overflow: 'hidden',
              maxHeight: containerExpanded ? 320 : 0,
              opacity: containerExpanded ? 1 : 0,
              borderRadius: 16,
              transition: `max-height 700ms ${ease} 150ms, opacity 500ms ${ease} 300ms`,
            }}
          >
            <div
              style={{
                height: 288,
                position: 'relative',
                backgroundImage: 'url(/dark_charcoal.png)',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                borderRadius: 16,
                overflow: 'hidden',
              }}
            >
              {/* Darkening overlay — 10% darker */}
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.10)', zIndex: 0 }} />
              {/* Face — left-anchored, 60% larger (160% height), 40% opacity */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/3face.png"
                alt=""
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: 32,
                  transform: 'translateY(-50%)',
                  height: '173%',
                  width: 'auto',
                  opacity: 0.4,
                  zIndex: 1,
                }}
              />
              {/* Tagline — one line, vertically centered, right side */}
              <span
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  zIndex: 1,
                  fontFamily: 'Montserrat, sans-serif',
                  color: '#ffffff',
                  fontSize: 104,
                  fontWeight: 800,
                  lineHeight: 1,
                  letterSpacing: '-0.04em',
                  whiteSpace: 'nowrap',
                }}
              >
                Level Up Now.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Sign-In Popup ─────────────── */
function SignInPopup({ onDismiss }: { onDismiss: () => void }) {
  const [show, setShow] = useState(false);
  const [closing, setClosing] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShow(true), 16);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    setClosing(true);
    setTimeout(onDismiss, 320);
  };

  const handleDone = () => {
    setDone(true);
    dismiss();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: show && !closing ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0)',
        transition: 'background 300ms ease',
      }}
      onClick={dismiss}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          transform: closing || !show ? 'scale(0.94) translateY(10px)' : 'scale(1) translateY(0)',
          opacity: closing || !show ? 0 : 1,
          transition: 'transform 300ms cubic-bezier(.2,.85,.2,1), opacity 280ms ease',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <div style={{ width: 40, transform: 'rotate(186deg)' }}>
          <BarberMascot />
        </div>
        <div style={{ position: 'relative', width: '100%', maxWidth: 640 }}>
          <button
            onClick={dismiss}
            className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full text-[var(--smoke)] hover:text-[var(--ink)] hover:bg-[var(--biscuit)] transition-all text-xs z-10"
          >
            ✕
          </button>
          {!done && <SignUpWidget onEnter={handleDone} large />}
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Selfie Fly Overlay ─────────────── */
function SelfieFlyOverlay({
  url, fromRect, toRect, onDone,
}: {
  url: string;
  fromRect: DOMRect;
  toRect: DOMRect;
  onDone: () => void;
}) {
  const [arrived, setArrived] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const t1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => setArrived(true));
    });
    const t2 = setTimeout(() => onDoneRef.current(), 820);
    return () => { cancelAnimationFrame(t1); clearTimeout(t2); };
  }, []);

  const fromCx = fromRect.left + fromRect.width / 2;
  const fromCy = fromRect.top + fromRect.height / 2;
  const toCx   = toRect.left + toRect.width / 2;
  const toCy   = toRect.top + toRect.height / 2;

  const startSize = Math.min(fromRect.width, fromRect.height) * 0.55;
  const endSize   = Math.max(toRect.width, toRect.height) * 0.72;

  const size   = arrived ? endSize   : startSize;
  const cx     = arrived ? toCx      : fromCx;
  const cy     = arrived ? toCy      : fromCy;
  const radius = arrived ? endSize / 2 : startSize * 0.12;
  const opacity = arrived ? 0 : 1;

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: size,
          height: size,
          left: cx - size / 2,
          top:  cy - size / 2,
          borderRadius: radius,
          overflow: 'hidden',
          opacity,
          transition: arrived
            ? 'left 680ms cubic-bezier(.32,.72,0,1), top 680ms cubic-bezier(.32,.72,0,1), width 680ms cubic-bezier(.32,.72,0,1), height 680ms cubic-bezier(.32,.72,0,1), border-radius 680ms cubic-bezier(.32,.72,0,1), opacity 200ms ease 480ms'
            : 'none',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
    </div>,
    document.body
  );
}

/* ─────────────── Scan Popup (camera in popup form) ─────────────── */
function ScanPopup({
  onScanComplete,
  onDismiss,
  needsUsername = false,
}: {
  onScanComplete: (p: UserHeadProfile, sid: string | null, url: string | null, fromRect?: DOMRect, isFirstScan?: boolean, splatUrl?: string) => void;
  onDismiss: () => void;
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

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(d => setPaywallDisabled(d.paywallDisabled ?? false));
  }, []);

  // Entry animation — two sequential phases: slide in edge-on, then rotate to face
  const [slideIn, setSlideIn] = useState(false);
  const [rotateIn, setRotateIn] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showRequirements, setShowRequirements] = useState(false);
  // Fades the right-panel content between username ↔ camera
  const [contentVisible, setContentVisible] = useState(true);

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

  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameError('');
    setUsernameLoading(true);
    try {
      await setUsernameMutation({ username: usernameValue.trim() });
      // Fade out current content, expand panel, then swap to camera
      setContentVisible(false);
      setTimeout(() => setExpanded(true), 120);
      setTimeout(() => { setPhase('camera'); setContentVisible(true); }, 500);
      setTimeout(() => setShowRequirements(true), 900);
    } catch (err: unknown) {
      setUsernameError(err instanceof Error ? err.message : 'Something went wrong');
      setUsernameLoading(false);
    }
  };

  const dismiss = () => {
    if (isDismissing.current) return;
    if (phase === 'processing') return;
    isDismissing.current = true;
    faceliftAbortRef.current?.abort();
    setCollapsing(true);
    setTimeout(() => setExiting(true), 350);
    setTimeout(onDismiss, 850);
  };

  const handleCapture = (p: UserHeadProfile, sid: string | null, url: string | null) => {
    setCaptured({ profile: p, sid, url });
    setPhase('verify');
    setTimeout(() => setShowVerifyBtns(true), 200);
  };

  const handleRetake = () => {
    setShowVerifyBtns(false);
    setTimeout(() => {
      setCaptured(null);
      setPhase('camera');
      setCameraKey(k => k + 1);
    }, 350);
  };

  const handleProceed = async () => {
    if (!captured || !capturedDataUrl) return;
    setShowVerifyBtns(false);
    setPhase('processing');
    setFaceliftStatus('processing');
    setFaceliftError(null);
    setActiveBarIndex(0);

    const abort = new AbortController();
    faceliftAbortRef.current = abort;

    try {
      const submitRes = await fetch('/api/facelift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl: capturedDataUrl }),
        signal: abort.signal,
      });

      if (submitRes.status === 401 || submitRes.status === 402) {
        const checkout = await fetch('/api/stripe/checkout', { method: 'POST' });
        const { url } = await checkout.json() as { url?: string };
        if (url) { window.location.href = url; return; }
      }
      if (!submitRes.ok) {
        const body = await submitRes.text().catch(() => '');
        throw new Error(`Couldn't start 3D build (${submitRes.status})${body ? ': ' + body : ''}`);
      }
      const { jobId } = await submitRes.json() as { jobId?: string };
      if (!jobId) throw new Error('Server did not return a job ID');

      let splatUrl: string | null = null;
      while (!abort.signal.aborted) {
        await new Promise(r => setTimeout(r, 5000));
        if (abort.signal.aborted) return;

        const pollRes = await fetch(
          `/api/facelift?jobId=${encodeURIComponent(jobId)}&outputName=scan-output`,
          { signal: abort.signal },
        );
        if (!pollRes.ok) {
          const body = await pollRes.text().catch(() => '');
          throw new Error(`Build check failed (${pollRes.status})${body ? ': ' + body : ''}`);
        }
        const data = await pollRes.json() as { status: string; splatUrl?: string; error?: string };
        console.log('[ScanPopup] poll response:', data.status, '| splatUrl:', data.splatUrl);
        if (data.status === 'success') { splatUrl = data.splatUrl!; break; }
        if (data.status === 'error') throw new Error(data.error ?? '3D build failed');
      }

      console.log('[ScanPopup] poll complete — splatUrl:', splatUrl);
      if (!splatUrl || abort.signal.aborted) return;

      setFaceliftStatus('done');
      setTimeout(() => {
        if (isDismissing.current) return;
        isDismissing.current = true;
        const fromRect = panelRef.current?.getBoundingClientRect() ?? undefined;
        console.log('[ScanPopup] calling onScanComplete with splatUrl:', splatUrl);
        setExiting(true);
        setTimeout(() => onScanComplete(captured.profile, captured.sid, captured.url, fromRect, wasFirstScanRef.current, splatUrl!), 600);
      }, 900);
    } catch (err) {
      if (abort.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      setFaceliftError(msg);
      setFaceliftStatus('error');
    }
  };

  const handleRetryFacelift = () => {
    setFaceliftStatus('idle');
    setFaceliftError(null);
    setPhase('processing');
    handleProceed();
  };

  const handleCancelFacelift = () => {
    faceliftAbortRef.current?.abort();
    setFaceliftStatus('idle');
    setFaceliftError(null);
    setPhase('camera');
    setCaptured(null);
    setCapturedDataUrl(null);
    setCameraKey(k => k + 1);
  };

  const panelTransition = exiting
    ? 'transform 500ms cubic-bezier(.2,.85,.2,1)'
    : collapsing
    ? 'width 460ms cubic-bezier(.4,0,1,1)'
    : expanded
    ? 'width 500ms cubic-bezier(.2,.85,.2,1)'
    : rotateIn
    ? 'transform 380ms cubic-bezier(.2,.85,.2,1)'
    : slideIn
    ? 'transform 280ms cubic-bezier(.2,.85,.2,1)'
    : 'none';

  // CCW rotation (rotateY 90deg→0). Two-phase entry: slide edge-on in, then rotate to face.
  const panelTransform = exiting
    ? 'perspective(1000px) translateX(-120%) rotateY(90deg)'
    : rotateIn
    ? 'perspective(1000px) translateX(0) rotateY(0deg)'
    : slideIn
    ? 'perspective(1000px) translateX(-16.667%) rotateY(90deg)'
    : 'perspective(1000px) translateX(-120%) rotateY(90deg)';

  return (
    <div
      className="fixed inset-0 z-40"
      style={{
        background: exiting ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,0.65)',
        transition: 'background 400ms ease',
      }}
      onClick={dismiss}
    >
      <div
        ref={panelRef}
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: '5vw',
          top: '5vh',
          height: '90vh',
          width: (collapsing || exiting) ? '30vw' : expanded ? '90vw' : '30vw',
          transform: panelTransform,
          opacity: 1,
          transition: panelTransition,
          background: '#201a13',
          borderRadius: 28,
          boxShadow: '0 40px 100px -24px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,248,234,0.08)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Body: flex row */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

          {/* LEFT PANEL — requirements or loading bars */}
          <div style={{
            width: (expanded && !collapsing && !exiting) ? '40vw' : '0vw',
            overflow: 'hidden',
            flexShrink: 0,
            transition: 'width 750ms cubic-bezier(.2,.85,.2,1)',
            borderRight: '1px solid rgba(255,248,234,0.07)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: (expanded && !collapsing && !exiting) ? '40px 52px' : '0',
          }}>
            {phase !== 'processing' && showRequirements && (
              <div style={{ display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 320 }}>
                <p style={{
                  fontFamily: 'var(--font-dmsans)',
                  fontSize: 18,
                  fontWeight: 600,
                  color: 'rgba(255,248,234,0.5)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.12em',
                  marginBottom: 28,
                }}>
                  <LetterFade text="Before you shoot" startDelay={0} charDelay={30} />
                </p>
                {SELFIE_REQS.map((req, i) => (
                  <div key={req.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 28 }}>
                    <span style={{ fontSize: 36, color: 'var(--tomato)', flexShrink: 0, lineHeight: 1 }}>{req.icon}</span>
                    <p style={{ fontFamily: 'var(--font-dmsans)', fontSize: 15, color: 'var(--cream)', fontWeight: 500, lineHeight: 1.4, margin: 0 }}>
                      <LetterFade text={req.label} startDelay={300 + i * 280} charDelay={22} />
                    </p>
                  </div>
                ))}
              </div>
            )}

            {phase === 'processing' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18, width: '100%', maxWidth: 320 }}>
                <p style={{
                  fontFamily: 'var(--font-fraunces)',
                  fontStyle: 'italic',
                  fontVariationSettings: "'SOFT' 50, 'WONK' 1, 'opsz' 144",
                  fontSize: 20,
                  fontWeight: 600,
                  color: 'var(--cream)',
                  opacity: 0.85,
                  marginBottom: 4,
                }}>
                  {faceliftStatus === 'error' ? 'Something went wrong' : 'Analyzing your look...'}
                </p>
                {SCAN_STEPS.map((s, i) => (
                  <OrganicBar
                    key={s.label}
                    label={s.label}
                    active={i <= activeBarIndex}
                    segments={s.segments}
                    holdAt88={s.holdAt88}
                    complete={faceliftStatus === 'done'}
                    onComplete={() => setActiveBarIndex(prev => Math.max(prev, i + 1))}
                  />
                ))}
                {faceliftStatus === 'processing' && (
                  <p style={{
                    fontFamily: 'var(--font-dmsans)',
                    fontSize: 11,
                    color: 'rgba(255,248,234,0.35)',
                    marginTop: 4,
                    fontStyle: 'italic',
                  }}>
                    Building your 3D model — this takes about 2 minutes
                  </p>
                )}
                {faceliftStatus === 'error' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                    <p style={{
                      fontFamily: 'var(--font-mono, monospace)',
                      fontSize: 10,
                      color: 'rgba(255,100,80,0.8)',
                      lineHeight: 1.4,
                      wordBreak: 'break-word',
                    }}>
                      {faceliftError ?? 'Unknown error'}
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={handleRetryFacelift}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          background: 'var(--tomato)',
                          color: 'var(--cream)',
                          border: 'none',
                          borderRadius: 8,
                          fontFamily: 'var(--font-dmsans)',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Try again
                      </button>
                      <button
                        onClick={handleCancelFacelift}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          background: 'rgba(255,248,234,0.08)',
                          color: 'rgba(255,248,234,0.6)',
                          border: 'none',
                          borderRadius: 8,
                          fontFamily: 'var(--font-dmsans)',
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        Retake photo
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT PANEL — header + camera */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px 28px 20px',
              flexShrink: 0,
              borderBottom: '1px solid rgba(255,248,234,0.07)',
              position: 'relative',
            }}>
              <h2
                className="type-chonk text-[var(--cream)] select-none"
                style={{
                  fontSize: 'clamp(1.8rem, 3.5vw, 3rem)',
                  lineHeight: 1,
                  transform: 'translateX(0)',
                }}
              >
                {phase === 'username' ? "Let's meet you" : 'Take a selfie!'}
              </h2>
              <button
                onClick={dismiss}
                className="absolute right-7 w-9 h-9 flex items-center justify-center rounded-full transition-all"
                style={{ color: 'rgba(255,248,234,0.5)', background: 'rgba(255,248,234,0.07)' }}
              >
                ✕
              </button>
            </div>

            {/* Body — fades between username form and camera */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px 28px',
                position: 'relative',
                minHeight: 0,
                opacity: contentVisible ? 1 : 0,
                transition: 'opacity 280ms ease',
              }}
            >

              {/* ── Username setup step ── */}
              {phase === 'username' && (
                <form
                  onSubmit={handleUsernameSubmit}
                  style={{
                    width: '100%',
                    maxWidth: 340,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 20,
                  }}
                >
                  <h2
                    className="type-chonk"
                    style={{
                      fontSize: 'clamp(2rem, 4vw, 3rem)',
                      color: 'var(--cream)',
                      lineHeight: 1,
                      margin: 0,
                    }}
                  >
                    Set up!
                  </h2>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p style={{
                      fontFamily: 'var(--font-dmsans)',
                      fontSize: 13,
                      color: 'rgba(255,248,234,0.5)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      fontWeight: 600,
                      margin: 0,
                    }}>
                      Choose a username
                    </p>
                    <p style={{
                      fontFamily: 'var(--font-dmsans)',
                      fontSize: 14,
                      color: 'rgba(255,248,234,0.6)',
                      margin: 0,
                      lineHeight: 1.5,
                    }}>
                      Letters, numbers, and underscores only.
                    </p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <input
                      autoFocus
                      type="text"
                      value={usernameValue}
                      onChange={e => { setUsernameValue(e.target.value); setUsernameError(''); }}
                      placeholder="e.g. freshcuts_mike"
                      maxLength={20}
                      style={{
                        fontFamily: 'var(--font-dmsans)',
                        fontSize: 16,
                        fontWeight: 500,
                        padding: '14px 18px',
                        borderRadius: 14,
                        border: usernameError
                          ? '1px solid rgba(220,80,60,0.7)'
                          : '1px solid rgba(255,248,234,0.14)',
                        background: 'rgba(255,248,234,0.06)',
                        color: 'var(--cream)',
                        outline: 'none',
                        width: '100%',
                        boxSizing: 'border-box',
                        transition: 'border-color 200ms ease',
                      }}
                    />
                    {usernameError && (
                      <p style={{
                        fontFamily: 'var(--font-dmsans)',
                        fontSize: 12,
                        color: 'rgba(220,80,60,0.9)',
                        margin: 0,
                      }}>
                        {usernameError}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={usernameLoading || usernameValue.trim().length < 2}
                    style={{
                      fontFamily: 'var(--font-dmsans)',
                      fontSize: 14,
                      fontWeight: 700,
                      padding: '13px 0',
                      borderRadius: 14,
                      border: 'none',
                      background: usernameLoading || usernameValue.trim().length < 2
                        ? 'rgba(255,248,234,0.12)'
                        : 'var(--cream)',
                      color: usernameLoading || usernameValue.trim().length < 2
                        ? 'rgba(255,248,234,0.3)'
                        : 'var(--ink)',
                      cursor: usernameLoading || usernameValue.trim().length < 2 ? 'default' : 'pointer',
                      width: '100%',
                      transition: 'background 200ms ease, color 200ms ease',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {usernameLoading ? 'Saving…' : 'Continue →'}
                  </button>
                </form>
              )}

              {phase === 'camera' && (
                <div
                  key={cameraKey}
                  style={{ width: '100%', maxWidth: 'min(460px, calc(90vh - 340px))', position: 'relative' }}
                >
                  <ScanCamera
                    hairType="straight"
                    onScanComplete={handleCapture}
                    onDataUrlReady={(d) => setCapturedDataUrl(d)}
                    onDismiss={dismiss}
                    onNoTokens={() => setShowPricing(true)}
                    paywallDisabled={paywallDisabled}
                  />
                </div>
              )}

              {(phase === 'verify' || phase === 'processing') && captured?.url && (
                <div style={{
                  width: '100%',
                  maxWidth: 460,
                  aspectRatio: '1',
                  borderRadius: 18,
                  overflow: 'hidden',
                  boxShadow: '0 20px 60px -16px rgba(0,0,0,0.5)',
                }}>
                  <img src={captured.url} alt="Your photo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}

              {(phase === 'verify' || phase === 'processing') && !captured?.url && (
                <div style={{ width: '100%', maxWidth: 460, aspectRatio: '1', borderRadius: 18, background: 'rgba(255,248,234,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 20px 60px -16px rgba(0,0,0,0.4)' }}>
                  <div style={{ width: 60, opacity: 0.25, transform: 'rotate(186deg)' }}><BarberMascot isStatic /></div>
                </div>
              )}

              {/* Verify buttons */}
              {phase === 'verify' && (
                <div style={{
                  position: 'absolute',
                  bottom: 24,
                  left: '50%',
                  transform: `translateX(-50%) translateY(${showVerifyBtns ? '0px' : '80px'})`,
                  transition: 'transform 430ms cubic-bezier(.2,.85,.2,1)',
                  display: 'flex',
                  gap: 12,
                  zIndex: 10,
                }}>
                  <BouncyButton onClick={handleRetake} className="btn btn-cream" style={{ padding: '13px 30px', fontSize: 14 }}>
                    ↺ Retake
                  </BouncyButton>
                  <BouncyButton onClick={handleProceed} className="btn btn-tomato" style={{ padding: '13px 30px', fontSize: 14 }}>
                    ✓ Proceed
                  </BouncyButton>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 28px', textAlign: 'center', borderTop: '1px solid rgba(255,248,234,0.06)', flexShrink: 0 }}>
          <span className="font-display italic text-sm" style={{ color: 'rgba(255,248,234,0.35)' }}>the looking glass ✂</span>
        </div>
      </div>

      {showPricing && <PricingPopup onDismiss={() => setShowPricing(false)} />}
    </div>
  );
}

/* ─────────────── Project Card ─────────────── */
interface ProjectDoc {
  _id: Id<'projects'>;
  name: string;
  thumbnailUrl?: string;
  lastHairParams?: HairParams;
  lastProfile?: UserHeadProfile;
  lastImageUrl?: string;
  updatedAt: number;
  savedAt?: number;
}

/* ─────────────── Flying Card (save animation) ─────────────── */
function FlyingCard({ fromRect, toPoint, thumbnailUrl, onDone }: {
  fromRect: DOMRect;
  toPoint: { x: number; y: number };
  thumbnailUrl?: string;
  onDone: () => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const sx = fromRect.left + fromRect.width / 2;
    const sy = fromRect.top + fromRect.height / 2;
    const ex = toPoint.x;
    const ey = toPoint.y;
    // Arc control point: sweep above both points
    const cpX = sx * 0.4 + ex * 0.6;
    const cpY = Math.min(sy, ey) - 170;

    const duration = 720;
    let startTime = 0;

    const tick = (now: number) => {
      if (!startTime) startTime = now;
      const raw = Math.min((now - startTime) / duration, 1);
      const t = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;

      const x = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * cpX + t * t * ex;
      const y = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * cpY + t * t * ey;
      const scale = 1 - t * 0.8;
      const opacity = raw > 0.7 ? Math.max(0, 1 - (raw - 0.7) / 0.3) : 1;

      el.style.transform = `translate(${x - sx}px, ${y - sy}px) scale(${scale})`;
      el.style.opacity = String(opacity);

      if (raw < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        onDoneRef.current();
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div
      ref={elRef}
      style={{
        position: 'fixed',
        left: fromRect.left,
        top: fromRect.top,
        width: fromRect.width,
        height: fromRect.height,
        borderRadius: 16,
        overflow: 'hidden',
        zIndex: 9999,
        pointerEvents: 'none',
        boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
        transformOrigin: 'center center',
        willChange: 'transform, opacity',
        border: '1.5px solid rgba(212,175,55,0.7)',
      }}
    >
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', background: 'var(--biscuit)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 40, opacity: 0.25, transform: 'rotate(186deg)' }}><BarberMascot isStatic color="var(--ink)" /></div>
        </div>
      )}
    </div>,
    document.body
  );
}

function ProjectCard({
  project,
  onClick,
  rotate = 0,
  onDelete,
  onSave,
}: { project: ProjectDoc; onClick: () => void; rotate?: number; onDelete?: () => void; onSave?: (cardRect: DOMRect) => void }) {
  const [zooming, setZooming] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isGlowing, setIsGlowing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [arrowHovered, setArrowHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const DRAWER_H = 72;
  const EASE = 'cubic-bezier(0,0,0.2,1)';
  const DUR = '270ms';
  const isSaved = !!project.savedAt;

  useEffect(() => {
    if (!drawerOpen) return;
    const handler = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setDrawerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [drawerOpen]);

  const handleCardClick = () => {
    if (drawerOpen) return;
    setZooming(true);
    setTimeout(onClick, 480);
  };

  const handleDelete = () => {
    setDrawerOpen(false);
    setTimeout(() => {
      setIsDeleting(true);
      setTimeout(() => { onDelete?.(); }, 350);
    }, 280);
  };

  const handleSave = () => {
    setDrawerOpen(false);
    setTimeout(() => {
      setIsGlowing(true);
      if (cardRef.current) onSave?.(cardRef.current.getBoundingClientRect());
      setTimeout(() => setIsGlowing(false), 1400);
    }, 240);
  };

  const cardTransform = isDeleting
    ? `scale(0.42) rotate(${(rotate || 0) - 15}deg)`
    : isHovered
    ? `rotate(${rotate || 0}deg) scale(1.025)`
    : rotate ? `rotate(${rotate}deg)` : undefined;

  const cardTransition = isDeleting
    ? 'transform 350ms cubic-bezier(0.4,0,1,1), opacity 350ms cubic-bezier(0.4,0,1,1)'
    : `box-shadow 380ms ease, border-color ${DUR} ${EASE}, transform 200ms ease`;

  const cardBorder = drawerOpen
    ? '1.5px solid transparent'
    : isGlowing
    ? '1.5px solid rgba(212,175,55,0.95)'
    : isSaved
    ? '1.5px solid rgba(212,175,55,0.6)'
    : isHovered
    ? '1.5px solid rgba(232,97,77,0.6)'
    : '1.5px solid rgba(42,32,26,0.25)';

  const arrowBorderColor = arrowHovered
    ? 'rgba(232,97,77,0.75)'
    : isGlowing
    ? 'rgba(212,175,55,0.95)'
    : isSaved
    ? 'rgba(212,175,55,0.6)'
    : 'rgba(42,32,26,0.25)';

  const cardShadow = isGlowing
    ? '0 0 0 4px rgba(212,175,55,0.45), 0 0 28px rgba(212,175,55,0.28), 0 8px 24px -8px rgba(0,0,0,0.18)'
    : isSaved
    ? '0 0 0 1px rgba(212,175,55,0.22), 0 8px 24px -8px rgba(0,0,0,0.18)'
    : '0 8px 24px -8px rgba(0,0,0,0.18)';

  return (
    <div
      ref={cardRef}
      className={`relative overflow-hidden ${zooming ? 'project-zoom' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        background: 'var(--cream)',
        border: cardBorder,
        aspectRatio: '3/4',
        borderRadius: 16,
        transform: cardTransform,
        opacity: isDeleting ? 0 : 1,
        transition: cardTransition,
        boxShadow: cardShadow,
        cursor: 'pointer',
        pointerEvents: isDeleting ? 'none' : 'auto',
      }}
    >
      {/* Drawer — sits at bottom, revealed when content slides up */}
      <div
        style={{
          position: 'absolute',
          bottom: 0, left: 0, right: 0,
          height: DRAWER_H,
          background: 'var(--cream)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 16px',
          zIndex: 1,
        }}
      >
        {/* Delete — red circle */}
        <button
          onClick={(e) => { e.stopPropagation(); handleDelete(); }}
          style={{
            width: 58, height: 58, borderRadius: '50%', border: 'none',
            background: 'rgba(214,60,47,0.1)', color: '#d63c2f',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0,
            transition: 'background 150ms ease, transform 120ms ease',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(214,60,47,0.18)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(214,60,47,0.1)'; }}
          onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.87)'; }}
          onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
          </svg>
        </button>
        {/* Save/unsave — coral→gold when saved, filled bookmark */}
        <button
          onClick={(e) => { e.stopPropagation(); handleSave(); }}
          style={{
            width: 58, height: 58, borderRadius: '50%', border: 'none',
            background: isSaved ? 'rgba(212,175,55,0.15)' : 'rgba(124,92,222,0.1)',
            color: isSaved ? 'rgba(180,140,30,1)' : '#7C5CDE',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0,
            transition: 'background 200ms ease, color 200ms ease, transform 120ms ease',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = isSaved ? 'rgba(212,175,55,0.25)' : 'rgba(124,92,222,0.18)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = isSaved ? 'rgba(212,175,55,0.15)' : 'rgba(124,92,222,0.1)'; }}
          onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.87)'; }}
          onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M5 3H19V21L12 15.5L5 21Z" />
          </svg>
        </button>
      </div>

      {/* Content — slides up to expose drawer; rounded bottom preserves curved edge */}
      <div
        onClick={handleCardClick}
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          borderRadius: '0 0 16px 16px',
          transform: drawerOpen ? `translateY(-${DRAWER_H}px)` : 'translateY(0)',
          transition: `transform ${DUR} ${EASE}`,
          zIndex: 2,
        }}
      >
        {project.thumbnailUrl ? (
          <img src={project.thumbnailUrl} alt={project.name} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'var(--biscuit)' }}>
            <div style={{ width: 40, opacity: 0.25, transform: 'rotate(186deg)' }}>
              <BarberMascot isStatic color="var(--ink)" />
            </div>
          </div>
        )}
        <div
          className="absolute bottom-0 left-0 right-0 px-3 py-2"
          style={{ background: 'linear-gradient(transparent, rgba(42,32,26,0.7))' }}
        >
          <span className="font-sans text-[11px] text-[var(--cream)]" style={{ fontWeight: 600 }}>
            {project.name}
          </span>
        </div>
      </div>

      {/* Arrow toggle — bottom-right, always on top */}
      <button
        onClick={(e) => { e.stopPropagation(); setDrawerOpen(o => !o); }}
        onMouseEnter={(e) => { e.stopPropagation(); setArrowHovered(true); }}
        onMouseLeave={(e) => { e.stopPropagation(); setArrowHovered(false); }}
        style={{
          position: 'absolute',
          bottom: drawerOpen ? DRAWER_H + 12 : 12,
          right: 14,
          zIndex: 3,
          width: 28, height: 28,
          borderRadius: '50%',
          border: `1.5px solid ${arrowBorderColor}`,
          background: 'var(--cream)',
          backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', padding: 0,
          boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
          color: arrowHovered ? 'var(--coral)' : 'var(--ink)',
          transform: arrowHovered ? 'scale(1.16)' : 'scale(1)',
          transition: `bottom ${DUR} ${EASE}, transform 180ms ease, border-color 150ms ease, color 150ms ease`,
        }}
      >
        <svg
          width="11" height="11" viewBox="0 0 10 10" fill="none"
          style={{
            transform: drawerOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: `transform ${DUR} ${EASE}`,
          }}
        >
          <path d="M2 6.5L5 3.5L8 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

/* ─────────────── Add Project Button ─────────────── */
function AddProjectButton({ onClick, isEmpty }: { onClick: () => void; isEmpty?: boolean }) {
  const [animPhase, setAnimPhase] = useState<'pre' | 'falling' | 'impact' | 'done'>('pre');

  useEffect(() => {
    if (!isEmpty) { setAnimPhase('pre'); return; }
    setAnimPhase('pre');
    const t1 = setTimeout(() => setAnimPhase('falling'), 600);
    const t2 = setTimeout(() => setAnimPhase('impact'),  1800);
    const t3 = setTimeout(() => setAnimPhase('done'),    5200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [isEmpty]);

  const isFalling = animPhase === 'falling';
  const isImpact  = animPhase === 'impact';

  return (
    <div
      style={{
        position: 'relative',
        overflow: 'visible',
      }}
    >
      <BouncyButton
        onClick={onClick}
        className="relative rounded-2xl flex items-center justify-center transition-opacity hover:opacity-90"
        style={{
          background: 'var(--cream)',
          border: '1.5px dashed rgba(42,32,26,0.3)',
          aspectRatio: '3/4',
          width: '100%',
        }}
      >
        {/* outer span: shake/sink/wobble on impact; inner span: quick swell on impact */}
        <span
          className="text-[var(--ink)] font-sans font-bold"
          style={{
            fontSize: 32,
            opacity: 0.7,
            lineHeight: 1,
            display: 'block',
            animation: isImpact
              ? 'empty-impact-shared 3.4s linear both'
              : 'none',
          }}
        >
          <span
            style={{
              display: 'block',
              animation: isImpact
                ? 'empty-plus-swell 0.45s cubic-bezier(.2,.85,.2,1) both'
                : 'none',
            }}
          >
            +
          </span>
        </span>
      </BouncyButton>

    </div>
  );
}



/* ─────────────── Selfie flight animation (initial scan → profile button) ─── */
function SelfieFlightOverlay({ imageUrl, onDone }: { imageUrl: string; onDone: () => void }) {
  const [flying, setFlying] = useState(false);
  const [vw, setVw] = useState(1920);
  const [vh, setVh] = useState(1080);

  useEffect(() => {
    setVw(window.innerWidth);
    setVh(window.innerHeight);
    const t1 = setTimeout(() => setFlying(true), 40);
    const t2 = setTimeout(onDone, 880);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const size = flying ? 44 : 200;
  // destination: top-right where the profile pill sits (~176px wide, 24px from right, 16px from top)
  const left = flying ? vw - 24 - 44 : vw / 2 - 100;
  const top  = flying ? 16            : vh / 2 - 100;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, pointerEvents: 'none' }}>
      <img
        src={imageUrl}
        alt=""
        style={{
          position: 'absolute',
          width: size,
          height: size,
          top,
          left,
          borderRadius: flying ? '50%' : 14,
          objectFit: 'cover',
          boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
          transition: 'top 750ms cubic-bezier(.4,0,.2,1), left 750ms cubic-bezier(.4,0,.2,1), width 750ms cubic-bezier(.4,0,.2,1), height 750ms cubic-bezier(.4,0,.2,1), border-radius 400ms ease',
          willChange: 'top, left, width, height',
        }}
      />
    </div>
  );
}

/* ─────────────── Face Video Swiper ─────────────── */
const FACE_VIDS = ['a','b','c','d','e'].map(l => `/landing_face1/face1${l}.mp4`);

const FACE_MESSAGES = [
  "Original Haircut (Swipe me!)",
  "Give me a wolf cut",
  "Slightly shorter wolf cut",
  "Give me a bleached buzz cut",
  "I want a korean perm middle part",
];

const IMSG_BLUE = '#007AFF';

type ChatMsg = {
  id: number;
  text: string;
  phase: 'entering' | 'idle' | 'disintegrating';
  disintDelay: number;
};

function ChatMsgBubble({ msg }: { msg: ChatMsg }) {
  const [showText, setShowText] = useState(false);

  // Very short typing indicator — 280ms
  useEffect(() => {
    const t = setTimeout(() => setShowText(true), 280);
    return () => clearTimeout(t);
  }, []);

  const entering = msg.phase === 'entering';
  const disint = msg.phase === 'disintegrating';

  return (
    <div
      style={{
        position: 'relative',
        background: IMSG_BLUE,
        color: 'white',
        borderRadius: showText ? '18px 18px 4px 18px' : '18px',
        padding: showText ? '8px 12px' : '8px 13px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif',
        fontSize: 13.5,
        fontWeight: 400,
        lineHeight: 1.35,
        letterSpacing: '-0.01em',
        maxWidth: '100%',
        boxShadow: '0 2px 10px rgba(0,80,200,0.22), 0 1px 3px rgba(0,0,0,0.14)',
        transition: 'border-radius 0.18s ease',
        animationName: disint ? 'msg-disintegrate' : entering ? 'msg-enter' : undefined,
        animationDuration: disint ? '0.4s' : '0.4s',
        animationFillMode: 'both',
        animationTimingFunction: disint ? 'ease-in' : 'cubic-bezier(0.34,1.2,0.64,1)',
        animationDelay: `${msg.disintDelay}ms`,
      }}
    >
      {!showText ? (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', height: 14 }}>
          {[0, 1, 2].map(i => (
            <div
              key={i}
              style={{
                width: 6, height: 6, borderRadius: '50%',
                background: 'rgba(255,255,255,0.88)',
                animationName: 'imessage-dot',
                animationDuration: '1s',
                animationTimingFunction: 'ease-in-out',
                animationIterationCount: 'infinite',
                animationDelay: `${i * 0.18}s`,
              }}
            />
          ))}
        </div>
      ) : (
        <span style={{ animationName: 'imessage-text-in', animationDuration: '0.18s', animationFillMode: 'both' }}>
          {msg.text}
        </span>
      )}

      {/* Tail — bottom-right, sent-message style, only when showing text */}
      {showText && !disint && (
        <svg
          style={{ position: 'absolute', bottom: 0, right: -8, display: 'block' }}
          width="12" height="11" viewBox="0 0 12 11"
        >
          <path d="M 0 0 Q 4 0 7 3 Q 10 6 12 11 Q 5 9 2 5 Q 0 3 0 0 Z" fill={IMSG_BLUE} />
        </svg>
      )}
    </div>
  );
}

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="phone-frame-bg"
      style={{
        width: 200,
        height: 330,
        borderRadius: 30,
        boxShadow: '0 20px 52px -10px rgba(180,40,30,0.52), 0 6px 20px -4px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,160,140,0.18)',
        flexShrink: 0,
      }}
    >
      {/* Screen */}
      <div style={{
        position: 'absolute',
        top: 4, left: 4, right: 4, bottom: 4,
        borderRadius: 24,
        background: '#F3F3F3',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 1,
      }}>
        {/* Dynamic island */}
        <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: '#F3F3F3' }}>
          <div style={{ width: 62, height: 13, background: '#1A1A1A', borderRadius: 9999 }} />
        </div>
        {/* Message area */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {children}
        </div>
        {/* Home bar */}
        <div style={{ height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <div style={{ width: 54, height: 4, background: 'rgba(0,0,0,0.18)', borderRadius: 9999 }} />
        </div>
      </div>
      {/* Volume buttons */}
      <div style={{ position: 'absolute', left: -3, top: 68, width: 4, height: 24, background: 'rgba(150,28,18,0.65)', borderRadius: '2px 0 0 2px', zIndex: 2 }} />
      <div style={{ position: 'absolute', left: -3, top: 102, width: 4, height: 24, background: 'rgba(150,28,18,0.65)', borderRadius: '2px 0 0 2px', zIndex: 2 }} />
      {/* Power button */}
      <div style={{ position: 'absolute', right: -3, top: 88, width: 4, height: 34, background: 'rgba(150,28,18,0.65)', borderRadius: '0 2px 2px 0', zIndex: 2 }} />
    </div>
  );
}

function ChatStack({ messages }: { messages: ChatMsg[] }) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 4,
        left: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: 6,
        overflow: 'hidden',
        maxHeight: '100%',
        padding: '0 10px',
      }}
    >
      {messages.map(msg => (
        <ChatMsgBubble key={msg.id} msg={msg} />
      ))}
    </div>
  );
}

function FaceVideoSwiper({ onSwipeUp, onSwipeDown, scrollRef, onActiveChange }: { onSwipeUp?: () => void; onSwipeDown?: () => void; scrollRef?: React.MutableRefObject<{ goNext: () => void; goPrev: () => void } | null>; onActiveChange?: (idx: number) => void }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const activeRef    = useRef(0);
  const videoRefs    = useRef<(HTMLVideoElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartY  = useRef(0);
  const wheelLock    = useRef(false);
  const onSwipeUpRef = useRef(onSwipeUp);
  const onSwipeDownRef = useRef(onSwipeDown);
  const onActiveChangeRef = useRef(onActiveChange);
  useEffect(() => { onSwipeUpRef.current = onSwipeUp; }, [onSwipeUp]);
  useEffect(() => { onSwipeDownRef.current = onSwipeDown; }, [onSwipeDown]);
  useEffect(() => { onActiveChangeRef.current = onActiveChange; }, [onActiveChange]);

  const switchTo = useCallback((newIdx: number) => {
    if (newIdx === activeRef.current) return;
    const cur  = videoRefs.current[activeRef.current];
    const next = videoRefs.current[newIdx];
    if (cur) cur.pause();
    if (next) {
      if (cur) next.currentTime = cur.currentTime;
      next.playbackRate = 1.3;
      next.play().catch(() => {});
    }
    activeRef.current = newIdx;
    setActiveIdx(newIdx);
    onActiveChangeRef.current?.(newIdx);
  }, []);

  const goNext = useCallback(() => { switchTo((activeRef.current + 1) % FACE_VIDS.length); onSwipeUpRef.current?.(); }, [switchTo]);
  const goPrev = useCallback(() => { switchTo((activeRef.current - 1 + FACE_VIDS.length) % FACE_VIDS.length); onSwipeDownRef.current?.(); }, [switchTo]);

  useEffect(() => {
    if (scrollRef) scrollRef.current = { goNext, goPrev };
  }, [scrollRef, goNext, goPrev]);

  // Start native playback at 1.3× on mount — hardware-decoded, no currentTime scrubbing.
  useEffect(() => {
    const vid = videoRefs.current[0];
    if (vid) {
      vid.playbackRate = 1.3;
      vid.play().catch(() => {});
    }
  }, []);

  // Native wheel listener with { passive: false } so we can preventDefault
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { wheelLock.current = false; idleTimer = null; }, 80);
      if (wheelLock.current) return;
      if (Math.abs(e.deltaY) < 5) return;
      wheelLock.current = true;
      if (e.deltaY > 0) goNext();
      else goPrev();
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => { el.removeEventListener('wheel', handler); if (idleTimer) clearTimeout(idleTimer); };
  }, [goNext, goPrev]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const delta = touchStartY.current - e.changedTouches[0].clientY;
    if (delta > 40) goNext();
    else if (delta < -40) goPrev();
  }, [goNext, goPrev]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 2,
      } as React.CSSProperties}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Visual layer: clip top 10% + blob mask. Kept separate from the event container so wheel/touch hit area is unaffected. */}
      <div style={{
        position: 'absolute', inset: 0,
        clipPath: 'inset(10% 0 0 0)',
        WebkitMaskImage: 'url(/blob.png)',
        WebkitMaskSize: '100% 100%',
        WebkitMaskRepeat: 'no-repeat',
        maskImage: 'url(/blob.png)',
        maskSize: '100% 100%',
        maskRepeat: 'no-repeat',
        pointerEvents: 'none',
      } as React.CSSProperties}>
        {/* 15% scale-down wrapper */}
        <div style={{ position: 'absolute', inset: 0, transform: 'scale(0.85)', transformOrigin: 'center center' }}>
          {FACE_VIDS.map((src, i) => (
            <video
              key={src}
              ref={el => { videoRefs.current[i] = el; }}
              src={src}
              muted
              playsInline
              loop
              preload="auto"
              style={{
                position: 'absolute',
                top: 0, left: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                opacity: i === activeIdx ? 1 : 0,
                transition: 'opacity 60ms ease',
                transform: i === 0 ? 'scale(1.02)' : i === 1 ? 'scale(0.95)' : i === 2 ? 'scale(0.96)' : i === 3 ? 'scale(0.97)' : i === 4 ? 'scale(0.96)' : undefined,
              }}
            />
          ))}
        </div>
      </div>

    </div>
  );
}

/* ─────────────── Scroll Arrows ─────────────── */
function ScrollArrows({ swipeTriggerRef, onClickUp, onClickDown }: { swipeTriggerRef: React.MutableRefObject<((dir: 'up' | 'down') => void) | null>; onClickUp?: () => void; onClickDown?: () => void }) {
  const upContainerRef = useRef<HTMLDivElement>(null);
  const downContainerRef = useRef<HTMLDivElement>(null);
  const [upHovered, setUpHovered] = useState(false);
  const [downHovered, setDownHovered] = useState(false);

  useEffect(() => {
    let rafId: number;
    let t = 0;
    const dt = 1 / 60;
    const S = 94;
    const EXIT_TARGET = S * 1.5;

    const es = {
      upActive: false, upY: 0, upOpacity: 1, upReturning: false, upReturnDelay: 0,
      downActive: false, downY: 0, downOpacity: 1, downReturning: false, downReturnDelay: 0,
    };

    swipeTriggerRef.current = (dir: 'up' | 'down') => {
      if (dir === 'up') {
        if (es.downReturning) es.downReturning = false;
        es.downActive = true; es.downY = 0; es.downOpacity = 1;
      } else {
        if (es.upReturning) es.upReturning = false;
        es.upActive = true; es.upY = 0; es.upOpacity = 1;
      }
    };

    const tick = () => {
      t += dt;

      const upFloatY = Math.sin(t * 0.63) * 6.5 + Math.sin(t * 1.27 + 0.4) * 1.8;
      const upFloatX = Math.sin(t * 0.41 + 0.8) * 2.5;
      const downFloatY = Math.sin(t * 0.71 + 1.9) * 6.5 + Math.sin(t * 1.15 + 0.9) * 1.8;
      const downFloatX = Math.sin(t * 0.47 + 1.4) * 2.5;

      // Exit animations
      if (es.upActive) {
        es.upY += (-EXIT_TARGET - es.upY) * 0.1;
        es.upOpacity -= 0.07;
        if (es.upOpacity <= 0) { es.upActive = false; es.upOpacity = 0; es.upY = 0; es.upReturning = true; es.upReturnDelay = 0.35; }
      }
      if (es.upReturning) {
        es.upReturnDelay -= dt;
        if (es.upReturnDelay <= 0) { es.upOpacity += 0.04; if (es.upOpacity >= 1) { es.upOpacity = 1; es.upReturning = false; } }
      }
      if (es.downActive) {
        es.downY += (EXIT_TARGET - es.downY) * 0.1;
        es.downOpacity -= 0.07;
        if (es.downOpacity <= 0) { es.downActive = false; es.downOpacity = 0; es.downY = 0; es.downReturning = true; es.downReturnDelay = 0.35; }
      }
      if (es.downReturning) {
        es.downReturnDelay -= dt;
        if (es.downReturnDelay <= 0) { es.downOpacity += 0.04; if (es.downOpacity >= 1) { es.downOpacity = 1; es.downReturning = false; } }
      }

      if (upContainerRef.current) {
        upContainerRef.current.style.transform = `translate(${upFloatX}px, ${upFloatY + es.upY}px)`;
        upContainerRef.current.style.opacity = String(Math.max(0, es.upOpacity));
      }
      if (downContainerRef.current) {
        downContainerRef.current.style.transform = `translate(${downFloatX}px, ${downFloatY + es.downY}px)`;
        downContainerRef.current.style.opacity = String(Math.max(0, es.downOpacity));
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(rafId); swipeTriggerRef.current = null; };
  }, [swipeTriggerRef]);

  const SH = 78;
  const SW = 140;
  // left: 30 + 200% of SW (170) = 370; tops derived from centered pair ± vertical shifts
  const arrowLeft = 218.5;

  return (
    <>
      <div
        ref={upContainerRef}
        onMouseEnter={() => setUpHovered(true)}
        onMouseLeave={() => setUpHovered(false)}
        onClick={onClickUp}
        style={{ position: 'absolute', left: arrowLeft, top: 'calc(50% - 314.4px)', width: SW, height: SH, willChange: 'transform', zIndex: 20, cursor: 'pointer' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={upHovered ? "/arrows/arrowup_highlighted.png" : "/arrows/arrowup.png"} alt="scroll up" style={{ width: SW, height: SH, display: 'block', position: 'relative' as const, zIndex: 1, opacity: upHovered ? 1 : 0.5, transition: 'opacity 0.15s ease' }} />
      </div>
      <div
        ref={downContainerRef}
        onMouseEnter={() => setDownHovered(true)}
        onMouseLeave={() => setDownHovered(false)}
        onClick={onClickDown}
        style={{ position: 'absolute', left: arrowLeft, top: 'calc(50% + 258px)', width: SW, height: SH, willChange: 'transform', zIndex: 20, cursor: 'pointer' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={downHovered ? "/arrows/arrowdown_highlighted.png" : "/arrows/arrowdown.png"} alt="scroll down" style={{ width: SW, height: SH, display: 'block', position: 'relative' as const, zIndex: 1, opacity: downHovered ? 1 : 0.5, transition: 'opacity 0.15s ease' }} />
      </div>
    </>
  );
}

/* ─────────────── Face2 Video Swiper + Show Barber Demo ─────────────── */
const FACE2_VIDS = ['/landing_face2/face2a.mp4', '/landing_face2/face2b.mp4', '/landing_face2/face2c.mp4', '/landing_face2/face2d.mp4', '/landing_face2/face2e.mp4', '/landing_face2/face2f.mp4'];

const FACE2_MESSAGES = [
  "6 inches shorter",
  "two pigtails",
  "wavy dirty blonde",
  "messy high bun",
  "blonde highlights and perm",
  "blonde",
];

function Face2VideoSwiper({
  scrollRef,
  onActiveChange,
  externalIdx,
  disableInteraction,
}: {
  scrollRef?: React.MutableRefObject<{ goNext: () => void; goPrev: () => void } | null>;
  onActiveChange?: (idx: number) => void;
  externalIdx?: number;
  disableInteraction?: boolean;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const activeRef = useRef(0);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const wheelLock = useRef(false);
  const onActiveChangeRef = useRef(onActiveChange);
  useEffect(() => { onActiveChangeRef.current = onActiveChange; }, [onActiveChange]);

  const switchTo = useCallback((newIdx: number) => {
    const cur = videoRefs.current[activeRef.current];
    const next = videoRefs.current[newIdx];
    if (cur) cur.pause();
    if (next) {
      if (cur) next.currentTime = cur.currentTime;
      next.play().catch(() => {});
    }
    activeRef.current = newIdx;
    setActiveIdx(newIdx);
    onActiveChangeRef.current?.(newIdx);
  }, []);

  const goNext = useCallback(() => switchTo((activeRef.current + 1) % FACE2_VIDS.length), [switchTo]);
  const goPrev = useCallback(() => switchTo((activeRef.current - 1 + FACE2_VIDS.length) % FACE2_VIDS.length), [switchTo]);

  useEffect(() => {
    if (scrollRef) scrollRef.current = { goNext, goPrev };
  }, [scrollRef, goNext, goPrev]);

  useEffect(() => {
    if (externalIdx !== undefined && externalIdx !== activeRef.current) {
      switchTo(externalIdx);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalIdx]);

  useEffect(() => {
    if (disableInteraction) return;
    const el = containerRef.current;
    if (!el) return;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { wheelLock.current = false; idleTimer = null; }, 80);
      if (wheelLock.current) return;
      if (Math.abs(e.deltaY) < 5) return;
      wheelLock.current = true;
      if (e.deltaY > 0) goNext();
      else goPrev();
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => { el.removeEventListener('wheel', handler); if (idleTimer) clearTimeout(idleTimer); };
  }, [disableInteraction, goNext, goPrev]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (disableInteraction) return;
    touchStartY.current = e.touches[0].clientY;
  }, [disableInteraction]);
  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (disableInteraction) return;
    const delta = touchStartY.current - e.changedTouches[0].clientY;
    if (delta > 40) goNext();
    else if (delta < -40) goPrev();
  }, [disableInteraction, goNext, goPrev]);

  // Speed curve is baked into the video — just play at 1×.
  useEffect(() => {
    videoRefs.current[0]?.play().catch(() => {});
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2 }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div style={{
        position: 'absolute', inset: 0,
        clipPath: 'inset(10% 0 0 0)',
        WebkitMaskImage: 'url(/blob.png)',
        WebkitMaskSize: '100% 100%',
        WebkitMaskRepeat: 'no-repeat',
        maskImage: 'url(/blob.png)',
        maskSize: '100% 100%',
        maskRepeat: 'no-repeat',
        pointerEvents: 'none',
      } as React.CSSProperties}>
        <div style={{ position: 'absolute', inset: 0, transform: 'scale(0.85)', transformOrigin: 'center center' }}>
          {FACE2_VIDS.map((src, i) => (
            <video
              key={src}
              ref={el => { videoRefs.current[i] = el; }}
              src={src}
              muted playsInline loop preload="auto"
              style={{
                position: 'absolute', top: 0, left: 0,
                width: '100%', height: '100%',
                objectFit: 'cover',
                opacity: i === activeIdx ? 1 : 0,
                transition: 'opacity 60ms ease',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Dark Phone Frame (iPhone-proportioned) ─────────────── */
function DarkPhoneFrame({ children, width = 168, cornerFraction = 0.24, screenBg = '#F3F3F3' }: { children: React.ReactNode; width?: number; cornerFraction?: number; screenBg?: string }) {
  const height = Math.round(width * 2.16);
  const br = Math.round(width * cornerFraction);
  const screenBr = Math.round(br * 0.88);
  const siH = Math.round(width * 0.04);
  const siV = Math.round(width * 0.028);
  const diH = Math.round(width * 0.145);
  const diW = Math.round(width * 0.32);
  const diDot = Math.round(width * 0.065);
  const homeBarW = Math.round(width * 0.27);
  const homeBarH = Math.round(height * 0.042);

  return (
    <div style={{ width, height, borderRadius: br, background: '#1C1C1E', position: 'relative', boxShadow: '0 20px 52px -10px rgba(0,0,0,0.55), 0 6px 20px -4px rgba(0,0,0,0.35)', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: siV, left: siH, right: siH, bottom: siV, borderRadius: screenBr, background: screenBg, overflow: 'hidden', display: 'flex', flexDirection: 'column', zIndex: 1 }}>
        <div style={{ height: diH, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: screenBg }}>
          <div style={{ width: diW, height: diDot, background: '#1C1C1E', borderRadius: 9999 }} />
        </div>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {children}
        </div>
        <div style={{ height: homeBarH, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: screenBg }}>
          <div style={{ width: homeBarW, height: 4, background: 'rgba(0,0,0,0.22)', borderRadius: 9999 }} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: -2, top: Math.round(height * 0.21), width: 3, height: Math.round(height * 0.07), background: '#3A3A3C', borderRadius: '2px 0 0 2px', zIndex: 2 }} />
      <div style={{ position: 'absolute', left: -2, top: Math.round(height * 0.30), width: 3, height: Math.round(height * 0.07), background: '#3A3A3C', borderRadius: '2px 0 0 2px', zIndex: 2 }} />
      <div style={{ position: 'absolute', right: -2, top: Math.round(height * 0.25), width: 3, height: Math.round(height * 0.1), background: '#3A3A3C', borderRadius: '0 2px 2px 0', zIndex: 2 }} />
    </div>
  );
}

/* brand colors for the describe phone */
const PHONE_TOMATO = '#D94E3A';
const PHONE_CREAM  = '#F5F1EA';
const PHONE_INK    = '#2a201a';

type DescribeChatMsg = { id: number; text: string; isNew: boolean; disintegrating?: boolean; disintegrateDelay?: number };

function DescribeMsgBubble({ msg }: { msg: DescribeChatMsg }) {
  const [showText, setShowText] = useState(!msg.isNew);

  useEffect(() => {
    if (!msg.isNew) return;
    const t = setTimeout(() => setShowText(true), 300);
    return () => clearTimeout(t);
  }, [msg.isNew]);

  return (
    <div
      style={{
        position: 'relative',
        background: PHONE_CREAM,
        color: PHONE_INK,
        borderRadius: showText ? '18px 18px 4px 18px' : '18px',
        padding: showText ? '8px 12px' : '8px 13px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif',
        fontSize: 14, fontWeight: 400, lineHeight: 1.35, letterSpacing: '-0.01em',
        maxWidth: '100%',
        boxShadow: '0 2px 10px rgba(80,20,10,0.14)',
        transition: 'border-radius 0.18s ease',
        animationName: msg.disintegrating ? 'msg-disintegrate' : msg.isNew ? 'msg-enter' : undefined,
        animationDuration: msg.disintegrating ? '0.5s' : '0.4s',
        animationDelay: msg.disintegrating ? `${msg.disintegrateDelay ?? 0}ms` : undefined,
        animationFillMode: 'both',
        animationTimingFunction: msg.disintegrating ? 'ease-in' : 'cubic-bezier(0.34,1.2,0.64,1)',
      }}
    >
      {!showText ? (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', height: 16 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 6, height: 6, borderRadius: '50%',
              background: PHONE_INK, opacity: 0.45,
              animationName: 'imessage-dot',
              animationDuration: '1s',
              animationTimingFunction: 'ease-in-out',
              animationIterationCount: 'infinite',
              animationDelay: `${i * 0.18}s`,
            }} />
          ))}
        </div>
      ) : (
        <span style={{ animationName: 'imessage-text-in', animationDuration: '0.18s', animationFillMode: 'both' }}>
          {msg.text}
        </span>
      )}
      {showText && (
        <svg style={{ position: 'absolute', bottom: 0, right: -8, display: 'block' }} width="12" height="11" viewBox="0 0 12 11">
          <path d="M 0 0 Q 4 0 7 3 Q 10 6 12 11 Q 5 9 2 5 Q 0 3 0 0 Z" fill={PHONE_CREAM} />
        </svg>
      )}
    </div>
  );
}

/* ─────────────── Describe Phone Demo (interactive, branded) ─────────────── */
function DescribePhoneDemo({ onSend }: { onSend?: (videoIdx: number) => void }) {
  const [msgs, setMsgs] = useState<DescribeChatMsg[]>([]);
  const [curIdx, setCurIdx] = useState(0);
  const idRef = useRef(0);
  const curIdxRef = useRef(0);
  const onSendRef = useRef(onSend);
  useEffect(() => { onSendRef.current = onSend; }, [onSend]);

  const chatAreaRef = useRef<HTMLDivElement>(null);
  const msgListRef = useRef<HTMLDivElement>(null);
  const lerpActiveRef = useRef(false);
  const pendingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearPending = useCallback(() => {
    pendingTimers.current.forEach(clearTimeout);
    pendingTimers.current = [];
  }, []);

  // On first message of each cycle: snap to bottom, then lerp to top after 200ms
  useEffect(() => {
    if (msgs.length !== 1 || lerpActiveRef.current) return;
    lerpActiveRef.current = true;

    const outer = chatAreaRef.current;
    const inner = msgListRef.current;
    if (!outer || !inner) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const outerH = outer.clientHeight;
        const innerH = inner.offsetHeight;
        const offset = Math.max(0, outerH - innerH - 6);

        inner.style.transition = 'none';
        inner.style.transform = `translateY(${offset}px)`;

        const t1 = setTimeout(() => {
          inner.style.transition = 'transform 600ms cubic-bezier(0.32, 0.72, 0, 1)';
          inner.style.transform = 'translateY(0px)';

          const t2 = setTimeout(() => {
            inner.style.transition = '';
            inner.style.transform = '';
          }, 600);
          pendingTimers.current.push(t2);
        }, 200);
        pendingTimers.current.push(t1);
      });
    });
  }, [msgs]);

  const handleSend = useCallback(() => {
    const idx = curIdxRef.current;
    const text = FACE2_MESSAGES[idx];
    const next = (idx + 1) % FACE2_MESSAGES.length;
    curIdxRef.current = next;
    setCurIdx(next);
    onSendRef.current?.(idx);

    if (idx === 0 && idRef.current > 0) {
      // Cycling back: disintegrate existing messages upward, then add the new first message
      setMsgs(prev => prev.map((m, i) => ({ ...m, isNew: false, disintegrating: true, disintegrateDelay: i * 60 })));
      const t = setTimeout(() => {
        clearPending();
        lerpActiveRef.current = false;
        if (msgListRef.current) {
          msgListRef.current.style.transition = 'none';
          msgListRef.current.style.transform = '';
        }
        idRef.current = 0;
        setMsgs([{ id: idRef.current++, text, isNew: true }]);
      }, 600);
      pendingTimers.current.push(t);
    } else {
      const newMsg: DescribeChatMsg = { id: idRef.current++, text, isNew: true };
      setMsgs(prev => [newMsg, ...prev.map(m => ({ ...m, isNew: false }))]);
    }
  }, [clearPending]);

  const nextMsg = FACE2_MESSAGES[curIdx];

  return (
    <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
      <div style={{
        width: '70%',
        aspectRatio: '966 / 1326',
        borderRadius: 18,
        background: PHONE_TOMATO,
        overflow: 'hidden',
        position: 'relative',
      }}>
        {/* Chat scroll area */}
        <div
          ref={chatAreaRef}
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 68,
            overflow: 'hidden',
          }}
        >
          <div
            ref={msgListRef}
            style={{
              position: 'absolute', top: 6, left: 0, right: 0,
              display: 'flex', flexDirection: 'column', gap: 7,
              padding: '0 12px',
            }}
          >
            {[...msgs].reverse().map(m => <DescribeMsgBubble key={m.id} msg={m} />)}
          </div>
        </div>
        {/* Typing bar */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 68,
          background: 'rgba(0,0,0,0.18)',
          display: 'flex', alignItems: 'center', padding: '0 12px', gap: 9,
        }}>
          <div style={{
            flex: 1, background: PHONE_CREAM, borderRadius: 22,
            padding: '8px 14px',
            fontSize: 13.5, color: PHONE_INK,
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            lineHeight: 1.35,
          }}>
            {nextMsg}
          </div>
          <button
            onClick={handleSend}
            className="send-btn-pulse"
            style={{
              width: 32, height: 32, borderRadius: '50%',
              background: PHONE_INK, border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
              <path d="M6 10.5V1.5M6 1.5L2.5 5M6 1.5L9.5 5" stroke={PHONE_CREAM} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Show Barber Demo (face2 swiper, no phone) ─────────────── */
function ShowBarberDemo({ activeIdx }: { activeIdx?: number }) {
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <Image src="/blob.png" alt="" width={619} height={677} style={{ width: '100%', height: 'auto', display: 'block' }} />
      <Face2VideoSwiper externalIdx={activeIdx} disableInteraction />
    </div>
  );
}

/* ─────────────── Glimpse / Orbit Section ─────────────── */
const GLIMPSE_SATELLITE_COUNT = 6;
const GLIMPSE_FINAL_RADIUS = 343;
const GLIMPSE_ERUPTION_DURATION = 1900;
const GLIMPSE_ORBIT_SPEED = 0.00022; // radians per ms, CCW

function GlimpseSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const satelliteRefs = useRef<(HTMLDivElement | null)[]>(Array(GLIMPSE_SATELLITE_COUNT).fill(null));
  const stateRef = useRef({ phase: 'idle' as 'idle' | 'erupting' | 'orbiting', eruptionStart: 0, orbitOffset: 0, lastTime: 0 });
  const rafRef = useRef<number>(0);
  const [centerVisible, setCenterVisible] = useState(false);

  const runFrame = useCallback((now: number) => {
    const s = stateRef.current;
    const dt = s.lastTime > 0 ? Math.min(now - s.lastTime, 50) : 16;
    s.lastTime = now;

    if (s.phase === 'erupting') {
      const elapsed = now - s.eruptionStart;
      const t = Math.min(elapsed / GLIMPSE_ERUPTION_DURATION, 1);
      // easeOutExpo: fast burst, decelerates
      const ease = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const radius = ease * GLIMPSE_FINAL_RADIUS;
      // total CCW sweep during eruption: 270°
      const sweepOffset = ease * (Math.PI * 1.5);

      for (let i = 0; i < GLIMPSE_SATELLITE_COUNT; i++) {
        const el = satelliteRefs.current[i];
        if (!el) continue;
        const baseAngle = (i / GLIMPSE_SATELLITE_COUNT) * Math.PI * 2;
        const angle = baseAngle - sweepOffset;
        const scale = 0.2 + ease * 0.8;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        el.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${scale})`;
        el.style.opacity = String(Math.min(1, ease * 1.8));
      }

      if (t >= 1) {
        s.phase = 'orbiting';
        s.orbitOffset = Math.PI * 1.5;
      }
    } else if (s.phase === 'orbiting') {
      s.orbitOffset += GLIMPSE_ORBIT_SPEED * dt;
      for (let i = 0; i < GLIMPSE_SATELLITE_COUNT; i++) {
        const el = satelliteRefs.current[i];
        if (!el) continue;
        const baseAngle = (i / GLIMPSE_SATELLITE_COUNT) * Math.PI * 2;
        const angle = baseAngle - s.orbitOffset;
        const x = Math.cos(angle) * GLIMPSE_FINAL_RADIUS;
        const y = Math.sin(angle) * GLIMPSE_FINAL_RADIUS;
        el.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(1)`;
        el.style.opacity = '1';
      }
    }

    if (s.phase !== 'idle') {
      rafRef.current = requestAnimationFrame(runFrame);
    }
  }, []);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && stateRef.current.phase === 'idle') {
          stateRef.current.phase = 'erupting';
          stateRef.current.eruptionStart = performance.now();
          stateRef.current.lastTime = 0;
          setCenterVisible(true);
          rafRef.current = requestAnimationFrame(runFrame);
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [runFrame]);

  const PALETTE = [
    'linear-gradient(135deg, #ffd4b8, #ffe7b0)',
    'linear-gradient(135deg, #ffe7b0, #f6ecd8)',
    'linear-gradient(135deg, #ffd4b8, #e8b454 80%)',
    'linear-gradient(135deg, #d8e8f4, #b0cce0)',
    'linear-gradient(135deg, #f5cc6b, #ffd4b8)',
    'linear-gradient(135deg, #c7d8b0, #ffe7b0)',
  ];

  return (
    <section style={{ padding: '100px 0 120px', textAlign: 'center', position: 'relative' }}>
      {/* Headline */}
      <h2
        className="font-serif"
        style={{ fontSize: 'clamp(1.9rem, 3.6vw, 3rem)', color: 'var(--cream)', marginBottom: 50, lineHeight: 1.25, letterSpacing: '-0.01em' }}
      >
        Get a glimpse of all{' '}
        <em
          className="font-display"
          style={{
            color: 'var(--tomato)',
            fontStyle: 'italic',
            fontVariationSettings: "'SOFT' 100, 'WONK' 1, 'opsz' 144",
            fontWeight: 900,
            fontSize: '1.18em',
          }}
        >
          &ldquo;you&rdquo;
        </em>{' '}
        could be.
      </h2>

      {/* Orbit stage */}
      <div
        ref={sectionRef}
        style={{ position: 'relative', height: 960, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {/* Center image */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 280,
            height: 280,
            marginLeft: -140,
            marginTop: -140,
            borderRadius: 28,
            overflow: 'hidden',
            background: 'var(--biscuit)',
            border: '2px solid rgba(42,32,26,0.12)',
            boxShadow: '0 24px 60px -12px rgba(0,0,0,0.22), 0 4px 12px -4px rgba(0,0,0,0.1)',
            zIndex: 2,
            transform: centerVisible ? 'scale(1)' : 'scale(0)',
            transition: centerVisible ? 'transform 680ms cubic-bezier(0.34, 1.56, 0.64, 1)' : 'none',
          }}
        >
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              background: 'linear-gradient(145deg, var(--peach) 0%, var(--butter) 55%, var(--biscuit) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div style={{ width: 80, opacity: 0.18, transform: 'rotate(186deg)' }}>
              <BarberMascot isStatic />
            </div>
            <img
              src="/face1_selfie.png"
              alt=""
              style={{
                position: 'absolute',
                top: 22,
                left: 22,
                right: 22,
                bottom: 22,
                width: 'calc(100% - 44px)',
                height: 'calc(100% - 44px)',
                objectFit: 'cover',
                objectPosition: 'center 12%',
                borderRadius: 14,
                boxShadow: '0 6px 24px -6px rgba(0,0,0,0.28)',
              }}
            />
          </div>
        </div>

        {/* Satellite hairstyle cards */}
        {[
          { name: 'Taper Fade', sub: 'clean & sharp' },
          { name: 'French Crop', sub: 'textured top' },
          { name: 'Textured Quiff', sub: 'volume & flow' },
          { name: 'Buzz Cut', sub: 'low maintenance' },
          { name: 'Curtain Bangs', sub: 'effortless cool' },
          { name: 'Mid Fade', sub: 'versatile classic' },
        ].map((style, i) => (
          <div
            key={i}
            ref={el => { satelliteRefs.current[i] = el; }}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 182,
              height: 237,
              transform: 'translate(-50%, -50%) scale(0)',
              opacity: 0,
              borderRadius: 20,
              overflow: 'hidden',
              background: PALETTE[i],
              border: '1.5px solid rgba(42,32,26,0.09)',
              boxShadow: '0 12px 36px -8px rgba(0,0,0,0.2)',
              zIndex: 1,
              willChange: 'transform, opacity',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              padding: '20px 18px',
            }}
          >
            <div style={{ width: 32, opacity: 0.2, transform: 'rotate(186deg)', marginBottom: 'auto', alignSelf: 'flex-end', marginTop: 20 }}>
              <BarberMascot isStatic color="#2a201a" />
            </div>
            <p
              className="font-display"
              style={{
                fontStyle: 'italic',
                fontVariationSettings: "'SOFT' 60, 'WONK' 1, 'opsz' 144",
                fontWeight: 700,
                fontSize: 22,
                color: 'var(--ink)',
                lineHeight: 1.1,
                margin: 0,
              }}
            >
              {style.name}
            </p>
            <p
              className="font-mono"
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                color: 'rgba(42,32,26,0.55)',
                margin: '6px 0 0',
              }}
            >
              {style.sub}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────────── Sign-Up Widget ─────────────── */
function SignUpWidget({ onEnter, large = false }: { onEnter: () => void; large?: boolean }) {
  const { signUp, setActive } = useSignUp();
  const { signIn } = useSignIn();
  const { isSignedIn } = useUser();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  // large (dashboard): combined email+password, no 'password' step
  // default (landing): multi-step — start → password → verify / 2fa
  const [step, setStep] = useState<'start' | 'password' | 'verify' | '2fa'>('start');
  const [secondFactorStrategy, setSecondFactorStrategy] = useState<'email_code' | 'totp' | 'phone_code' | 'backup_code'>('email_code');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Size tokens
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

  // Shared auth logic: try sign-in first (no verification for returning users),
  // fall back to sign-up with email verification only for new accounts.
  const submitCredentials = async () => {
    if (!signIn || !signUp || !setActive) return;
    setSubmitting(true);
    setError('');
    try {
      // Try sign-in first — existing users never hit email verification
      let signInResult;
      try {
        signInResult = await signIn.create({ strategy: 'password', identifier: email.trim(), password });
      } catch (rawErr: unknown) {
        const err = rawErr as { errors?: Array<{ code?: string; message?: string }> };
        const firstErr = err?.errors?.[0];
        const isNotFound = firstErr?.code === 'form_identifier_not_found'
          || (firstErr?.message ?? '').toLowerCase().includes('find');
        if (!isNotFound) {
          const msg = firstErr?.message ?? 'Something went wrong';
          setError(msg.toLowerCase().includes('password') ? 'Wrong password — try again.' : msg);
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
            supported.find(f => f.strategy === 'email_code') ? 'email_code' :
            supported.find(f => f.strategy === 'phone_code') ? 'phone_code' :
            supported.find(f => f.strategy === 'totp') ? 'totp' :
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

      // New user — sign up and require email verification once
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
      const e = err as { errors?: Array<{ message?: string }> };
      setError(e?.errors?.[0]?.message ?? (err instanceof Error ? err.message : 'Something went wrong'));
    } finally {
      setSubmitting(false);
    }
  };

  // Landing page: advance from email step to password step
  const handleEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setError('');
    setStep('password');
  };

  // Landing page: password step submit
  const handlePassword = async (e: React.FormEvent) => { e.preventDefault(); if (!password) return; await submitCredentials(); };

  // Dashboard: combined email+password submit
  const handleSubmit = async (e: React.FormEvent) => { e.preventDefault(); if (!email.trim() || !password) return; await submitCredentials(); };

  // Email verification code (only when Clerk requires it after sign-up)
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
    if (!signIn) return;
    setError('');
    try {
      await signIn.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl: `${window.location.origin}/sso-callback`,
        redirectUrlComplete: `${window.location.origin}/`,
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
            /* Dashboard: email + password together */
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
            /* Landing page: email only, advances to password step */
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

/* ─────────────── Landing Page ─────────────── */
/* ─────────────── Landing Pricing Section ─────────────── */
/* ─────────────── Landing Pricing Cards ─────────────── */
const PRICING_PLANS = [
  {
    id: 'free',
    label: 'Free',
    price: 'Free',
    sub: 'forever',
    tokens: null as number | null,
    perToken: null as string | null,
    tokenLabel: 'Prebaked styles',
    line: 'Browse 30+ expert-curated styles rendered on your 3D scan — no generation needed, no cost ever.',
    cta: 'Start free',
    featured: false,
    freeOnly: true,
  },
  {
    id: 'starter',
    label: 'Starter',
    price: '$1.99',
    sub: 'one-time',
    tokens: 20,
    perToken: '10¢',
    tokenLabel: '20 AI looks',
    line: '20 custom renders. Enough to test a fade, a crop, and a taper before your next appointment.',
    cta: 'Try 20 looks',
    featured: false,
    freeOnly: false,
  },
  {
    id: 'popular',
    label: 'Popular',
    price: '$4.99',
    sub: 'one-time',
    tokens: 60,
    perToken: '8¢',
    tokenLabel: '60 AI looks',
    line: '60 looks to explore. Find what works for your face shape, then walk in with a reference photo.',
    cta: 'Get 60 looks',
    featured: true,
    freeOnly: false,
  },
  {
    id: 'lifetime',
    label: 'Pro',
    price: '$14.99',
    sub: 'one-time',
    tokens: 500,
    perToken: '3¢',
    tokenLabel: '500 AI looks',
    line: 'Serious about your hair. 500 looks at 3¢ each — experiment until you find a signature style.',
    cta: 'Get 500 looks',
    featured: false,
    freeOnly: false,
  },
] as const;

function LandingPricingCards({ onEnter }: { onEnter: () => void }) {
  const { isSignedIn } = useUser();
  const [loading, setLoading] = useState<string | null>(null);

  const handleClick = async (planId: string) => {
    if (planId === 'free') { onEnter(); return; }
    if (!isSignedIn) { onEnter(); return; }
    if (loading) return;
    setLoading(planId);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      });
      const data = await res.json() as { url?: string };
      if (data.url) window.location.href = data.url;
    } finally { setLoading(null); }
  };

  return (
    <div id="pricing" style={{ padding: '0 0 72px' }}>
      {/* Curved outer box — identical to standalone pricing page */}
      <div style={{
        borderRadius: 36,
        backgroundImage: 'url(/dark_charcoal.png)', backgroundSize: 'cover', backgroundPosition: 'center',
        border: '1px solid rgba(255,248,234,0.18)',
        boxShadow: '0 40px 100px -28px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,248,234,0.08)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '52px 56px 52px', borderBottom: '1px solid rgba(255,248,234,0.14)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 }}>
          <h2 style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontSize: 'clamp(2.8rem, 5vw, 4.2rem)', fontWeight: 900, color: 'var(--cream)', lineHeight: 0.95, margin: 0, letterSpacing: '-0.03em' }}>
            pricing
          </h2>
          <p style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontStyle: 'italic', fontSize: 20, color: 'rgba(255,248,234,0.72)', margin: 0, maxWidth: 460, lineHeight: 1.3 }}>
            See yourself in the cut before you sit in the chair.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 4 }}>
            <div style={{
              background: 'linear-gradient(140deg, rgba(255,248,234,0.16) 0%, rgba(255,248,234,0.06) 100%)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(255,248,234,0.26)',
              borderRadius: 18, padding: '16px 32px', textAlign: 'center',
            }}>
              <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,248,234,0.62)', marginBottom: 8 }}>
                avg barber visit
              </div>
              <div style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontSize: 'clamp(1.9rem, 2.6vw, 2.6rem)', fontWeight: 900, color: 'var(--cream)', lineHeight: 1, letterSpacing: '-0.03em' }}>
                $45
              </div>
            </div>

            <div style={{ color: 'rgba(255,248,234,0.35)', fontSize: 22, lineHeight: 1 }}>→</div>

            <div style={{
              background: 'linear-gradient(140deg, rgba(82,202,120,0.22) 0%, rgba(82,202,120,0.07) 100%)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(82,202,120,0.42)',
              borderRadius: 18, padding: '16px 32px', textAlign: 'center',
            }}>
              <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(82,202,120,0.9)', marginBottom: 8 }}>
                1 AI look
              </div>
              <div style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontSize: 'clamp(1.9rem, 2.6vw, 2.6rem)', fontWeight: 900, color: '#52ca78', lineHeight: 1, letterSpacing: '-0.03em' }}>
                8¢
              </div>
            </div>
          </div>
        </div>

        {/* Plan cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0 }}>
          {PRICING_PLANS.map((plan, i) => {
            const isLast = i === PRICING_PLANS.length - 1;
            const isFeatured = plan.featured;
            return (
              <div
                key={plan.id}
                style={{
                  padding: '32px 28px 36px',
                  display: 'flex', flexDirection: 'column',
                  borderRight: !isLast ? '1px solid rgba(255,248,234,0.13)' : 'none',
                  background: isFeatured ? 'rgba(255,248,234,0.08)' : 'transparent',
                  position: 'relative',
                }}
              >
                {isFeatured && (
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--tomato)' }} />
                )}

                <div style={{
                  fontFamily: 'var(--font-jetbrains), monospace',
                  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.18em', fontWeight: 600,
                  color: isFeatured ? 'var(--tomato)' : 'rgba(255,248,234,0.58)',
                  marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  {plan.label}
                  {isFeatured && (
                    <span style={{ background: 'rgba(217,78,58,0.2)', color: 'var(--tomato)', borderRadius: 9999, padding: '2px 8px', fontSize: 9 }}>
                      popular
                    </span>
                  )}
                </div>

                <div style={{ marginBottom: 4 }}>
                  <span style={{
                    fontFamily: 'var(--font-fraunces), Georgia, serif',
                    fontSize: 'clamp(2rem, 3vw, 2.8rem)', fontWeight: 900,
                    color: 'var(--cream)', lineHeight: 1, letterSpacing: '-0.03em',
                  }}>
                    {plan.price}
                  </span>
                </div>

                <div style={{
                  fontFamily: 'var(--font-jetbrains), monospace',
                  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em',
                  color: 'rgba(255,248,234,0.48)', marginBottom: 20,
                }}>
                  {plan.perToken ? `${plan.perToken} / token` : plan.sub}
                </div>

                <div style={{ borderTop: '1px solid rgba(255,248,234,0.13)', marginBottom: 18 }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    background: plan.freeOnly ? 'rgba(255,248,234,0.07)' : 'rgba(217,78,58,0.18)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <div style={{ width: 13, transform: 'rotate(186deg)' }}>
                      <BarberMascot isStatic color={plan.freeOnly ? 'rgba(255,248,234,0.58)' : 'var(--tomato)'} />
                    </div>
                  </div>
                  <span style={{ fontFamily: 'var(--font-dmsans), sans-serif', fontSize: 15, fontWeight: 700, color: 'var(--cream)' }}>
                    {plan.tokenLabel}
                  </span>
                </div>

                <p style={{
                  fontFamily: 'var(--font-dmsans), sans-serif',
                  fontSize: 13, color: 'rgba(255,248,234,0.64)', lineHeight: 1.55,
                  margin: '0 0 24px', flex: 1,
                }}>
                  {plan.line}
                </p>

                <button
                  onClick={() => handleClick(plan.id)}
                  disabled={loading === plan.id}
                  className={isFeatured ? 'btn-tomato' : ''}
                  style={{
                    width: '100%', padding: '13px 16px',
                    fontFamily: 'var(--font-dmsans), sans-serif',
                    fontSize: 13, fontWeight: 700, borderRadius: 12, cursor: 'pointer',
                    border: isFeatured ? 'none' : '1px solid rgba(255,248,234,0.18)',
                    background: isFeatured ? undefined : 'rgba(255,248,234,0.07)',
                    color: isFeatured ? undefined : 'var(--cream)',
                    transition: 'background 140ms ease',
                    opacity: loading === plan.id ? 0.6 : 1,
                  }}
                  onMouseEnter={e => { if (!isFeatured) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,248,234,0.12)'; }}
                  onMouseLeave={e => { if (!isFeatured) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,248,234,0.07)'; }}
                >
                  {loading === plan.id ? '…' : plan.cta}
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer note inside the box */}
        <div style={{ padding: '20px 56px 24px', borderTop: '1px solid rgba(255,248,234,0.13)', textAlign: 'center' }}>
          <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(255,248,234,0.42)' }}>
            one-time purchase · no subscription · secured by stripe
          </span>
        </div>
      </div>
    </div>
  );
}

function LandingPage({ onEnter }: { onEnter: () => void }) {
  const swipeTriggerRef = useRef<((dir: 'up' | 'down') => void) | null>(null);
  const faceScrollRef = useRef<{ goNext: () => void; goPrev: () => void } | null>(null);

  const smoothScrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const start = window.scrollY;
    const end = el.getBoundingClientRect().top + window.scrollY;
    const dist = end - start;
    const duration = 1100;
    const ease = (t: number) => t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
    let t0: number | null = null;
    const tick = (now: number) => {
      if (t0 === null) t0 = now;
      const t = Math.min((now - t0) / duration, 1);
      window.scrollTo(0, start + dist * ease(t));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const scrollToHowItWorks = () => smoothScrollTo('how-it-works');
  const scrollToPricing = () => smoothScrollTo('pricing');

  const [describeActiveIdx, setDescribeActiveIdx] = useState<number | undefined>(undefined);

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      {/* ─── Light section ─── */}
      <div style={{ backgroundImage: 'url(/offwhitebg.png)', backgroundSize: 'cover', backgroundPosition: 'center top', position: 'relative' }}>
      {/* Gradient blobs */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 800px 500px at 10% 5%, rgba(255,212,184,0.55), transparent 60%),' +
            'radial-gradient(ellipse 600px 400px at 90% 90%, rgba(107,153,191,0.14), transparent 60%),' +
            'radial-gradient(ellipse 500px 350px at 55% 50%, rgba(255,231,176,0.3), transparent 70%)',
        }}
      />

      <div className="relative z-10" style={{ maxWidth: 1320, margin: '0 auto', padding: '28px 56px 80px' }}>

        {/* ── Nav ── */}
        <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28 }}><BarberMascot isStatic color="#2a201a" /></div>
            <div className="type-chonk" style={{ fontSize: 30, lineHeight: 1, margin: 0, color: 'var(--ink)' }}>
              shape<em style={{ color: 'var(--tomato)' }}>up</em>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
            <button
              onClick={scrollToHowItWorks}
              className="font-serif italic"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--char)', fontSize: 16, opacity: 0.7, transition: 'opacity 140ms ease' }}
              onMouseEnter={e => ((e.target as HTMLElement).style.opacity = '1')}
              onMouseLeave={e => ((e.target as HTMLElement).style.opacity = '0.7')}
            >
              how it works
            </button>
            <button
              onClick={scrollToPricing}
              className="font-serif italic"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--char)', fontSize: 16, opacity: 0.7, transition: 'opacity 140ms ease' }}
              onMouseEnter={e => ((e.target as HTMLElement).style.opacity = '1')}
              onMouseLeave={e => ((e.target as HTMLElement).style.opacity = '0.7')}
            >
              pricing
            </button>
          </div>
          <BouncyButton
            onClick={onEnter}
            className="btn-tomato"
            style={{ padding: '11px 22px', fontSize: 13, borderRadius: 10 }}
          >
            try it free →
          </BouncyButton>
        </nav>

        {/* ── Hero ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.1fr 1fr',
            gap: 56,
            alignItems: 'center',
            marginTop: 52,
            position: 'relative',
          }}
        >
          {/* Left */}
          <div style={{ position: 'relative', zIndex: 2, textAlign: 'center' }} className="anim-fade-up">
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(217,78,58,0.07)', border: '1px solid rgba(217,78,58,0.25)', borderRadius: 9999, padding: '5px 14px', marginTop: 8 }}>
              <span style={{ color: 'var(--tomato)', fontSize: 10 }}>✦</span>
              <span className="font-mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--char)', opacity: 0.8 }}>Free to try · No credit card · 3D preview in ~60 sec</span>
            </div>
            <div
              className="type-chonk"
              style={{ fontSize: 'clamp(2rem, 3.8vw, 3rem)', marginTop: 16, color: 'var(--ink)', lineHeight: 1.05 }}
            >
              <div>see it first.</div>
              <div>love it more.</div>
            </div>

            <p
              className="font-serif italic"
              style={{ fontSize: 18, color: 'var(--char)', maxWidth: 480, marginTop: 22, lineHeight: 1.5 }}
            >
              Take one selfie. See 10+ haircuts on your actual 3D face.
              <br />Walk into the barber knowing exactly what you want.
            </p>

            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 34 }}>
              <SignUpWidget onEnter={onEnter} />
            </div>
          </div>

          {/* Right — blob visual */}
          <div
            style={{ position: 'relative', height: 640, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}
            className="anim-fade-in delay-200"
          >
            <div style={{ position: 'relative', width: 624, zIndex: 1 }}>
              <Image src="/blob.png" alt="" width={619} height={677} style={{ width: '100%', height: 'auto', display: 'block' }} />
              <FaceVideoSwiper
                onSwipeUp={() => swipeTriggerRef.current?.('up')}
                onSwipeDown={() => swipeTriggerRef.current?.('down')}
                scrollRef={faceScrollRef}
              />
              <ScrollArrows
                swipeTriggerRef={swipeTriggerRef}
                onClickUp={() => faceScrollRef.current?.goPrev()}
                onClickDown={() => faceScrollRef.current?.goNext()}
              />
            </div>
          </div>
        </div>

        {/* ── Problem section ── */}
        <div className="anim-fade-up" style={{ margin: '80px 0 0', padding: '72px 0 80px', borderTop: '1.5px solid rgba(42,32,26,0.08)' }}>
          <p className="font-mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.18em', color: 'var(--tomato)', textAlign: 'center', marginBottom: 22 }}>
            sound familiar?
          </p>
          <h2
            className="type-chonk"
            style={{ fontSize: 'clamp(1.9rem, 3.2vw, 2.8rem)', color: 'var(--ink)', textAlign: 'center', lineHeight: 1.05, marginBottom: 18 }}
          >
            You describe it.
            <br />
            <em style={{ color: 'var(--tomato)' }}>They hear something different.</em>
          </h2>
          <p className="font-serif italic" style={{ fontSize: 17, color: 'var(--char)', textAlign: 'center', opacity: 0.62, maxWidth: 500, margin: '0 auto 56px', lineHeight: 1.6 }}>
            Most people walk out of the barber having settled — not because the barber was bad,
            but because there was no way to show exactly what they meant.
          </p>

          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 52 }}>
            {[
              {
                stat: '~6 weeks',
                label: 'to grow back a bad cut',
                desc: 'Hair grows about half an inch a month. A cut you didn\'t want just… stays.',
              },
              {
                stat: '$45+ a visit',
                label: 'no preview, full commitment',
                desc: 'You\'re all-in before you see anything. No refunds, no take-backs.',
              },
              {
                stat: '1 in 3',
                label: 'leave wishing they\'d said more',
                desc: 'Most people stay quiet in the chair. The cut is fine. But it\'s not what they pictured.',
              },
            ].map((item, i) => (
              <div
                key={i}
                style={{
                  background: 'var(--biscuit)',
                  border: '1.5px solid rgba(42,32,26,0.1)',
                  borderRadius: 18,
                  padding: '28px 26px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div
                  className="font-display"
                  style={{ fontStyle: 'italic', fontVariationSettings: "'SOFT' 100, 'WONK' 0, 'opsz' 144", fontWeight: 900, fontSize: 'clamp(1.5rem, 2.1vw, 2rem)', color: 'var(--tomato)', lineHeight: 1 }}
                >
                  {item.stat}
                </div>
                <div className="font-mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(42,32,26,0.45)', marginBottom: 4 }}>
                  {item.label}
                </div>
                <div className="font-sans" style={{ fontSize: 14, color: 'var(--char)', lineHeight: 1.6, opacity: 0.7 }}>
                  {item.desc}
                </div>
              </div>
            ))}
          </div>

          {/* Bridge line */}
          <p className="font-serif italic" style={{ fontSize: 19, color: 'var(--ink)', textAlign: 'center', lineHeight: 1.5, maxWidth: 520, margin: '0 auto' }}>
            The cut you want is stuck in your head.{' '}
            <span style={{ color: 'var(--tomato)' }}>Shape Up puts it on your actual face</span>
            {' '}— before you ever sit in the chair.
          </p>
        </div>

        {/* ── Value props bar ── */}
        <div style={{ borderTop: '1.5px solid rgba(42,32,26,0.18)', borderBottom: '1.5px solid rgba(42,32,26,0.18)', margin: '56px 0 0', padding: '65px 0', backgroundImage: 'url(/white.png)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {[
              { stat: '1 selfie', label: 'all you need to start' },
              { stat: '~60 sec', label: 'scan to first 3D preview' },
              { stat: 'free to start', label: 'no card required' },
            ].map((item, i) => (
              <div key={i} style={{ textAlign: 'center', padding: '8px 0', borderRight: i < 2 ? '1.5px solid rgba(42,32,26,0.18)' : 'none' }}>
                <div className="font-display" style={{ fontStyle: 'italic', fontVariationSettings: "'SOFT' 100, 'WONK' 0, 'opsz' 144", fontWeight: 900, fontSize: 'clamp(1.3rem, 2vw, 1.7rem)', color: 'var(--tomato)', lineHeight: 1.1 }}>
                  {item.stat}
                </div>
                <div className="font-mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(42,32,26,0.45)', marginTop: 5 }}>
                  {item.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Steps ── */}
        <div id="how-it-works" style={{ marginTop: 80, paddingTop: 8 }}>
          <p className="font-mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.18em', color: 'var(--smoke)', textAlign: 'center', marginBottom: 56 }}>
            how it works
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 40, alignItems: 'start' }}>

            {/* Step 1: Scan */}
            <div className="anim-fade-up delay-100" style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
              <Image src="/1.png" alt="Step 1" width={52} height={52} style={{ width: 52, height: 52, objectFit: 'contain' }} />
              <span className="font-sans" style={{ fontSize: 26, fontWeight: 700, color: 'var(--char)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>Scan</span>
              <span className="font-mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(42,32,26,0.45)' }}>30 seconds</span>
              <Image
                src="/landing_face2/face2_selfie.png"
                alt="Scan your face"
                width={600} height={600}
                style={{ width: '70%', height: 'auto', borderRadius: 18 }}
              />
            </div>

            {/* Step 2: Describe */}
            <div className="anim-fade-up delay-200" style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
              <Image src="/2.png" alt="Step 2" width={52} height={52} style={{ width: 52, height: 52, objectFit: 'contain' }} />
              <span className="font-sans" style={{ fontSize: 26, fontWeight: 700, color: 'var(--char)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>Describe</span>
              <span className="font-mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(42,32,26,0.45)' }}>just type or tap</span>
              <DescribePhoneDemo onSend={setDescribeActiveIdx} />
            </div>

            {/* Step 3: Show your barber */}
            <div className="anim-fade-up delay-300" style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
              <Image src="/3.png" alt="Step 3" width={52} height={52} style={{ width: 52, height: 52, objectFit: 'contain' }} />
              <span className="font-sans" style={{ fontSize: 26, fontWeight: 700, color: 'var(--char)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>Show your barber</span>
              <span className="font-mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(42,32,26,0.45)' }}>share your 3D preview</span>
              <ShowBarberDemo activeIdx={describeActiveIdx} />
            </div>

          </div>
        </div>

        {/* ── Mid-page CTA ── */}
        <div style={{ textAlign: 'center', padding: '72px 0 16px' }}>
          <p className="font-serif italic" style={{ fontSize: 17, color: 'var(--char)', opacity: 0.6, margin: '0 0 20px' }}>
            Ready to see your next cut?
          </p>
          <BouncyButton
            onClick={onEnter}
            className="btn-tomato"
            style={{
              padding: '18px 44px',
              fontSize: 20,
              fontFamily: 'var(--font-fraunces), Georgia, serif',
              fontVariationSettings: "'SOFT' 100, 'WONK' 0, 'opsz' 144",
              fontWeight: 900,
              letterSpacing: '-0.01em',
              borderRadius: 18,
              boxShadow: '0 8px 28px -6px rgba(217,78,58,0.45)',
            }}
          >
            Preview My Cut — It&apos;s Free →
          </BouncyButton>
          <p className="font-mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(42,32,26,0.38)', marginTop: 14 }}>
            takes about 60 seconds · no account required
          </p>
        </div>

      </div>
      </div>

      {/* ── Transition image ── */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/transition.png" alt="" style={{ display: 'block', width: '100%' }} />

      {/* ── Dark charcoal section ── */}
      <div style={{ backgroundImage: 'url(/dark_charcoal.png)', backgroundSize: 'cover', backgroundPosition: 'center top' }}>
        <div style={{ maxWidth: 1320, margin: '0 auto', padding: '0 56px' }}>

          {/* ── Glimpse orbit section ── */}
          <GlimpseSection />

          {/* ── Pricing ── */}
          <LandingPricingCards onEnter={onEnter} />

          {/* ── Orbit CTA ── */}
          <div style={{ textAlign: 'center', padding: '0 0 72px' }}>
            <p className="font-display" style={{ fontStyle: 'italic', fontVariationSettings: "'SOFT' 100, 'WONK' 0, 'opsz' 144", fontWeight: 700, fontSize: 'clamp(1.1rem, 1.8vw, 1.4rem)', color: 'rgba(255,248,234,0.6)', margin: '0 0 20px' }}>
              Pick your style.
            </p>
            <BouncyButton
              onClick={onEnter}
              className="btn-tomato"
              style={{
                padding: '18px 44px',
                fontSize: 20,
                fontFamily: 'var(--font-fraunces), Georgia, serif',
                fontVariationSettings: "'SOFT' 100, 'WONK' 0, 'opsz' 144",
                fontWeight: 900,
                letterSpacing: '-0.01em',
                borderRadius: 18,
                boxShadow: '0 8px 28px -6px rgba(217,78,58,0.45)',
              }}
            >
              Try It Free — No Card Needed →
            </BouncyButton>
            <p className="font-mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(255,248,234,0.3)', marginTop: 14 }}>
              takes about 60 seconds
            </p>
          </div>

          {/* ── Trust Strip ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, padding: '0 0 64px' }}>
            {[
              { title: 'Your photo stays private', body: 'We never sell or share your scan. Delete your data anytime from settings.' },
              { title: 'AI trained on real cuts', body: '3D facial mesh and strand-level simulation built from real barbershop styles.' },
              { title: 'Free to try, no risk', body: 'Your first previews are completely free. Pay only if you love the results.' },
            ].map((item, i) => (
              <div key={i} style={{ background: 'rgba(255,248,234,0.05)', border: '1px solid rgba(255,248,234,0.1)', borderRadius: 16, padding: '24px 22px' }}>
                <div className="font-sans" style={{ fontSize: 15, fontWeight: 600, color: 'var(--cream)', marginBottom: 8 }}>{item.title}</div>
                <div className="font-sans" style={{ fontSize: 13, color: 'rgba(255,248,234,0.5)', lineHeight: 1.6 }}>{item.body}</div>
              </div>
            ))}
          </div>

          {/* ── Footer strip ── */}
          <div style={{ borderTop: '1px solid rgba(255,248,234,0.12)', padding: '28px 0 40px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {/* Instagram */}
              <a
                href="https://instagram.com/unchopped_"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: 'rgba(255,248,234,0.6)', opacity: 0.7, transition: 'opacity 140ms ease' }}
                onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = '1')}
                onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = '0.7')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                </svg>
                <span className="font-sans" style={{ fontSize: 13, fontWeight: 500, letterSpacing: '0.01em' }}>@unchopped_</span>
              </a>

              {/* Brand */}
              <div style={{ textAlign: 'center' }}>
                <span className="font-serif italic" style={{ fontSize: 22, color: 'var(--cream)', fontStyle: 'italic', opacity: 0.6 }}>Shape Up</span>
                <sup className="font-sans" style={{ fontSize: 9, marginLeft: 2, verticalAlign: 'super', color: 'rgba(255,248,234,0.5)', opacity: 0.5 }}>™</sup>
              </div>

              {/* Email */}
              <a
                href="mailto:shapeup.ai@gmail.com"
                style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: 'rgba(255,248,234,0.6)', opacity: 0.7, transition: 'opacity 140ms ease' }}
                onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = '1')}
                onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = '0.7')}
              >
                <span className="font-sans" style={{ fontSize: 13, fontWeight: 500, letterSpacing: '0.01em' }}>shapeup.ai@gmail.com</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="3" />
                  <polyline points="2,4 12,13 22,4" />
                </svg>
              </a>
            </div>
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              {[
                { label: 'Privacy', href: '/privacy' },
                { label: 'Terms', href: '/terms' },
                { label: 'Biometric notice', href: '/biometric-notice' },
                { label: 'Delete my data', href: '/delete-my-data' },
                { label: 'Contact', href: 'mailto:shapeup.ai@gmail.com' },
              ].map(({ label, href }, i) => (
                <span key={label}>
                  <a
                    href={href}
                    className="font-mono"
                    style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,248,234,0.3)', textDecoration: 'none', transition: 'color 140ms ease' }}
                    onMouseEnter={e => ((e.target as HTMLElement).style.color = 'rgba(255,248,234,0.6)')}
                    onMouseLeave={e => ((e.target as HTMLElement).style.color = 'rgba(255,248,234,0.3)')}
                  >
                    {label}
                  </a>
                  {i < 4 && <span className="font-mono" style={{ fontSize: 10, color: 'rgba(255,248,234,0.15)', margin: '0 14px' }}>·</span>}
                </span>
              ))}
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}

/* ─────────────── Dashboard stat pill ─────────────── */
function DashStat({ icon, top, bottom }: { icon: React.ReactNode; top: string; bottom: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <span style={{ color: 'rgba(42,32,26,0.7)', fontSize: 18 }}>{icon}</span>
      <div style={{ lineHeight: 1.15 }}>
        <div className="font-mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'rgba(42,32,26,0.65)', textTransform: 'uppercase' }}>{top}</div>
        <div className="font-sans" style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{bottom}</div>
      </div>
    </div>
  );
}

/* ─────────────── Main Menu ─────────────── */
function MainMenu({
  onAdd,
  onOpenProject,
  showScanNow,
  onScanNow,
  onRescan,
  onSignIn,
  profilePillPulse = false,
  celebratePurchase = false,
}: {
  onAdd: () => void;
  onOpenProject: (project: ProjectDoc) => void;
  showScanNow: boolean;
  onScanNow: () => void;
  onRescan: () => void;
  onSignIn: () => void;
  profilePillPulse?: boolean;
  celebratePurchase?: boolean;
}) {
  const projects = useQuery(api.projects.list) as ProjectDoc[] | undefined;
  const removeProject = useMutation(api.projects.remove);
  const toggleSaveProject = useMutation(api.projects.toggleSave);
  const [menuVisible, setMenuVisible] = useState(false);
  const [logoVisible, setLogoVisible] = useState(false);
  const [rightVisible, setRightVisible] = useState(false);
  const [activeNav, setActiveNav] = useState('home');
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [flyingCard, setFlyingCard] = useState<{
    fromRect: DOMRect;
    toPoint: { x: number; y: number };
    thumbnailUrl?: string;
  } | null>(null);

  const cardWrapRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevFlipPositions = useRef<Map<string, { top: number; left: number }>>(new Map());
  const pendingFlip = useRef(false);
  const vpRef = useRef<HTMLDivElement>(null);
  const [vpH, setVpH] = useState(0);

  useLayoutEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setVpH(entry.contentRect.height));
    ro.observe(el);
    setVpH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  const snapshotForFlip = () => {
    prevFlipPositions.current = new Map();
    cardWrapRefs.current.forEach((el, id) => {
      const r = el.getBoundingClientRect();
      prevFlipPositions.current.set(id, { top: r.top, left: r.left });
    });
    pendingFlip.current = true;
  };

  useLayoutEffect(() => {
    if (!pendingFlip.current) return;
    pendingFlip.current = false;
    cardWrapRefs.current.forEach((el, id) => {
      const prev = prevFlipPositions.current.get(id);
      if (!prev) return;
      const curr = el.getBoundingClientRect();
      const dx = prev.left - curr.left;
      const dy = prev.top - curr.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transition = 'transform 320ms cubic-bezier(0,0,0.2,1)';
          el.style.transform = '';
        });
      });
    });
    prevFlipPositions.current = new Map();
  });

  const hasSavedProjects = !!(projects?.some(p => !!p.savedAt));

  const floorIndex = activeNav === 'home' ? 0 : activeNav === 'saved' ? 1 : 2;

  const floorSliderRef = useRef<HTMLDivElement>(null);
  const sidebarDarkRef = useRef<HTMLDivElement>(null);
  const topbarDarkRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const prevFloorRef = useRef(floorIndex);

  useEffect(() => {
    if (!vpH) return;
    const floorSlider = floorSliderRef.current;
    const sidebarDark = sidebarDarkRef.current;
    const topbarDark = topbarDarkRef.current;
    if (!floorSlider || !sidebarDark || !topbarDark) return;

    cancelAnimationFrame(rafRef.current);

    const prevFloor = prevFloorRef.current;
    prevFloorRef.current = floorIndex;

    // Home↔Explore direct jump — neither endpoint is saved, keep overlays fully hidden
    if (floorIndex !== 1 && prevFloor !== 1) {
      sidebarDark.style.clipPath = 'inset(100% 0 0 0)';
      topbarDark.style.opacity = '0';
      return;
    }

    const step1 = vpH + 320;       // translateY magnitude at saved floor
    const step2 = 2 * vpH + 640;   // translateY magnitude at explore floor

    let lastP = -1;
    let stableFrames = 0;

    const tick = () => {
      const matrix = new DOMMatrix(window.getComputedStyle(floorSlider).transform);
      const p = -matrix.m42; // positive: 0 at home, step1 at saved, step2 at explore

      // charcoalAmount: 0 at home, 1 at saved, 0 at explore (triangle)
      let charcoalAmount: number;
      if (p <= step1) {
        charcoalAmount = p / step1;
      } else {
        charcoalAmount = 1 - (p - step1) / (step2 - step1);
      }
      charcoalAmount = Math.max(0, Math.min(1, charcoalAmount));

      // Sidebar: clip-path reveals dark overlay from the bottom upward, in sync with scroll
      sidebarDark.style.clipPath = `inset(${(1 - charcoalAmount) * 100}% 0 0 0)`;

      // Topbar: only activates once the charcoal floor is nearly at the top of the viewport
      topbarDark.style.opacity = charcoalAmount > 0.85 ? '1' : '0';

      // Self-terminate once position stabilises (animation settled)
      if (Math.abs(p - lastP) < 0.5) {
        stableFrames++;
        if (stableFrames > 4) {
          const isAtSaved = floorIndex === 1;
          sidebarDark.style.clipPath = `inset(${isAtSaved ? 0 : 100}% 0 0 0)`;
          topbarDark.style.opacity = isAtSaved ? '1' : '0';
          return;
        }
      } else {
        stableFrames = 0;
      }
      lastP = p;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [floorIndex, vpH]);

  const homeProjects = (() => {
    if (!projects) return undefined;
    let list = [...projects];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q));
    }
    if (activeTab === 'recent') list = list.slice(0, 6);
    return list;
  })();

  const savedProjects = (() => {
    if (!projects) return undefined;
    let list = projects.filter(p => !!p.savedAt);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q));
    }
    if (activeTab === 'recent') list = list.slice(0, 6);
    return list;
  })();

  const handleSaveProject = (p: ProjectDoc, cardRect: DOMRect) => {
    toggleSaveProject({ projectId: p._id });
    if (!p.savedAt) {
      const savedBtn = document.querySelector('[data-nav="saved"]');
      if (savedBtn) {
        const r = savedBtn.getBoundingClientRect();
        setFlyingCard({
          fromRect: cardRect,
          toPoint: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
          thumbnailUrl: p.thumbnailUrl,
        });
      }
    }
  };

  useEffect(() => {
    const t1 = setTimeout(() => setMenuVisible(true), 60);
    const t2 = setTimeout(() => setLogoVisible(true), 190);
    const t3 = setTimeout(() => setRightVisible(true), 380);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  const navItems: Array<{ key: string; icon: React.ReactNode; onClick?: () => void }> = [
    {
      key: 'home',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12L12 3L21 12" /><path d="M5 10.5V20H9.5V15H14.5V20H19V10.5" />
        </svg>
      ),
    },
    {
      key: 'saved',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 3H19V21L12 15.5L5 21Z" />
        </svg>
      ),
    },
    {
      key: 'explore',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L22 22" />
        </svg>
      ),
    },
  ];

  return (
    <main className="relative overflow-hidden" style={{ height: '100vh', background: 'var(--biscuit-lt)' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '88px 1fr',
          height: '100vh',
          opacity: menuVisible ? 1 : 0,
          transition: 'opacity 400ms ease',
        }}
      >

        {/* ── LEFT NAV RAIL ── */}
        <aside
          style={{
            borderRight: '2px solid rgba(42,32,26,0.22)',
            background: 'var(--biscuit)',
            zIndex: 2,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Light layer */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', padding: '24px 10px', height: '100%', position: 'relative', zIndex: 1 }}>
            <div style={{ marginBottom: 24, width: 30, transform: 'rotate(186deg)', opacity: 0.85 }}>
              <BarberMascot isStatic color="var(--ink)" />
            </div>
            {navItems.map(n => {
              const isActive = n.key === activeNav;
              return (
                <button key={n.key} data-nav={n.key} onClick={n.onClick ?? (() => setActiveNav(n.key))}
                  style={{ border: 'none', cursor: 'pointer', background: isActive ? 'rgba(232,97,77,0.1)' : 'transparent', color: isActive ? 'var(--coral)' : 'var(--ink)', padding: '10px 0', borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: 66, fontSize: 9.5, fontFamily: 'var(--font-dmsans)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', outline: isActive ? '1.5px solid rgba(232,97,77,0.28)' : '1.5px solid transparent', transition: 'background 160ms ease, color 160ms ease, outline-color 160ms ease' }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(42,32,26,0.05)'; }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  {n.icon}<span>{n.key}</span>
                </button>
              );
            })}
          </div>

          {/* Dark wipe overlay — clipPath driven by RAF in sync with floor slider */}
          <div ref={sidebarDarkRef} style={{
            position: 'absolute', inset: 0,
            background: '#181b17',
            borderRight: '2px solid rgba(252,245,228,0.1)',
            display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', padding: '24px 10px',
            clipPath: 'inset(0 0 100% 0)',
            zIndex: 2,
          }}>
            <div style={{ marginBottom: 24, width: 30, transform: 'rotate(186deg)', opacity: 0.75 }}>
              <BarberMascot isStatic color="#fcf5e4" />
            </div>
            {navItems.map(n => {
              const isActive = n.key === activeNav;
              return (
                <button key={n.key} data-nav={n.key} onClick={n.onClick ?? (() => setActiveNav(n.key))}
                  style={{ border: 'none', cursor: 'pointer', background: isActive ? 'rgba(232,97,77,0.18)' : 'transparent', color: isActive ? 'var(--coral)' : 'rgba(252,245,228,0.7)', padding: '10px 0', borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: 66, fontSize: 9.5, fontFamily: 'var(--font-dmsans)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', outline: isActive ? '1.5px solid rgba(232,97,77,0.35)' : '1.5px solid transparent', transition: 'background 160ms ease, color 160ms ease, outline-color 160ms ease' }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(252,245,228,0.07)'; }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  {n.icon}<span>{n.key}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* ── MAIN CONTENT ── */}
        <div className="min-w-0" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', position: 'relative' }}>

          {/* Fixed top bar */}
          <div style={{ flexShrink: 0, position: 'relative', zIndex: 10, overflow: 'hidden' }}>
            {/* Light layer */}
            <div style={{ padding: '24px 40px 0', position: 'relative', zIndex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div className={logoVisible ? 'slide-in-left' : 'opacity-0'}>
                  <InlineWordmark />
                </div>
                <div className={`flex items-center gap-3 ${rightVisible ? 'slide-in-right' : 'opacity-0'}`}>
                  <ProfileMenu onRescan={onRescan} onSignIn={onSignIn} pulse={profilePillPulse} celebratePurchase={celebratePurchase} />
                </div>
              </div>
            </div>

            {/* Dark overlay — opacity driven by RAF, only shows when charcoal floor reaches top */}
            <div ref={topbarDarkRef} style={{
              position: 'absolute', inset: 0,
              background: '#181b17',
              opacity: 0,
              transition: 'opacity 120ms ease',
              zIndex: 2,
              padding: '24px 40px 0',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div className={logoVisible ? 'slide-in-left' : 'opacity-0'}>
                  <InlineWordmark cream />
                </div>
                <div className={`flex items-center gap-3 ${rightVisible ? 'slide-in-right' : 'opacity-0'}`}>
                  <ProfileMenu onRescan={onRescan} onSignIn={onSignIn} pulse={profilePillPulse} celebratePurchase={celebratePurchase} />
                </div>
              </div>
            </div>
          </div>

          {/* Floor slider viewport */}
          <div ref={vpRef} style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            {/* 3-floor inner container — floors are vpH tall, gaps (320px) between them are only visible during transition */}
            <div
              ref={floorSliderRef}
              style={{
                transform: vpH ? `translateY(${floorIndex === 0 ? 0 : floorIndex === 1 ? -(vpH + 320) : -(2 * vpH + 640)}px)` : 'translateY(0)',
                transition: vpH ? 'transform 540ms cubic-bezier(0.34, 1.08, 0.64, 1)' : 'none',
                willChange: 'transform',
              }}
            >

              {/* Floor 0 — Home */}
              <div className="cozy-scroll" style={{ height: vpH || '100vh', overflowY: 'auto', padding: '0 40px 80px' }}>
                {/* Title row */}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32, marginTop: 28 }}>
                  <div>
                    <h1 className="type-chonk" style={{ margin: 0, fontSize: 'clamp(4.5rem, 7vw, 6.5rem)', color: 'var(--ink)', lineHeight: 0.88 }}>
                      My Cuts
                    </h1>
                  </div>
                  <div style={{ flex: 1 }} />
                  <div style={{ position: 'relative', width: 248 }}>
                    <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'rgba(42,32,26,0.55)', fontSize: 14, pointerEvents: 'none' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                        <circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L22 22" />
                      </svg>
                    </span>
                    <input
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="find a style..."
                      style={{ width: '100%', padding: '10px 14px 10px 38px', border: '1.5px solid rgba(42,32,26,0.28)', borderRadius: 9999, background: 'rgba(42,32,26,0.05)', fontSize: 14, color: 'var(--ink)', fontFamily: 'var(--font-fraunces), Georgia, serif', fontStyle: 'italic', outline: 'none' }}
                      onFocus={e => (e.target.style.borderColor = 'rgba(232,97,77,0.5)')}
                      onBlur={e => (e.target.style.borderColor = 'rgba(42,32,26,0.28)')}
                    />
                  </div>
                </div>
                {/* Tabs */}
                <div style={{ display: 'flex', gap: 10, marginTop: 28, alignItems: 'center' }}>
                  {['all', 'recent'].map(t => (
                    <button key={t} onClick={() => setActiveTab(t)} style={{ padding: '7px 17px', border: `1.5px solid ${activeTab === t ? 'rgba(232,97,77,0.55)' : 'rgba(42,32,26,0.28)'}`, background: activeTab === t ? 'rgba(232,97,77,0.08)' : 'transparent', borderRadius: 9999, cursor: 'pointer', fontFamily: 'var(--font-dmsans)', fontWeight: 700, fontSize: 13, color: activeTab === t ? 'var(--coral)' : 'rgba(42,32,26,0.7)', letterSpacing: '0.02em', transition: 'all 160ms ease' }}>
                      {t}
                    </button>
                  ))}
                </div>
                {/* Project grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 28, marginTop: 24 }}>
                  <AddProjectButton onClick={onAdd} isEmpty={projects !== undefined && projects.length === 0} />
                  {homeProjects?.map((p, i) => (
                    <div key={p._id} ref={el => { if (el) cardWrapRefs.current.set(p._id, el); else cardWrapRefs.current.delete(p._id); }}>
                      <ProjectCard
                        project={p}
                        onClick={() => onOpenProject(p)}
                        rotate={[-1.4, 0.8, -0.6, 1.2, -0.8][i % 5]}
                        onDelete={() => { snapshotForFlip(); removeProject({ projectId: p._id }); }}
                        onSave={(cardRect) => handleSaveProject(p, cardRect)}
                      />
                    </div>
                  ))}
                </div>
                {/* Scan CTA when empty */}
                {showScanNow && !(projects && projects.length > 0) && (
                  <div className="mt-8 flex justify-center scan-btn-pop">
                    <BouncyButton onClick={onScanNow} className="btn" style={{ padding: '12px 28px', fontSize: 14, background: 'var(--coral)', color: 'var(--offwhite)', boxShadow: '0 4px 20px -4px rgba(232,97,77,0.4)' }}>
                      ✂ Scan now
                    </BouncyButton>
                  </div>
                )}
              </div>

              {/* ── Gap band: Home → Saved ── only visible during transition */}
              <div style={{ height: 320, flexShrink: 0, pointerEvents: 'none' }}>
                <svg viewBox="0 0 1440 320" preserveAspectRatio="none" style={{ width: '100%', height: 320, display: 'block' }}>
                  <rect width="1440" height="320" fill="#fcf5e4" />
                  <path d="M0,320 L0,180 C240,70 480,290 720,180 C960,70 1200,290 1440,180 L1440,320 Z" fill="#2b2e27" />
                </svg>
              </div>

              {/* Floor 1 — Saved (full charcoal) */}
              <div className="cozy-scroll" style={{ height: vpH || '100vh', overflowY: 'auto', backgroundImage: 'url(/dark_charcoal.png)', backgroundSize: 'cover', backgroundPosition: 'center', padding: '24px 40px 80px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32, marginTop: 28 }}>
                  <div>
                    <h1 className="type-chonk" style={{ margin: 0, fontSize: 'clamp(4.5rem, 7vw, 6.5rem)', color: '#fcf5e4', lineHeight: 0.88 }}>
                      Saved
                    </h1>
                  </div>
                  <div style={{ flex: 1 }} />
                  <div style={{ position: 'relative', width: 248 }}>
                    <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'rgba(252,245,228,0.55)', fontSize: 14, pointerEvents: 'none' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                        <circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L22 22" />
                      </svg>
                    </span>
                    <input
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="find a style..."
                      style={{ width: '100%', padding: '10px 14px 10px 38px', border: '1.5px solid rgba(252,245,228,0.28)', borderRadius: 9999, background: 'rgba(252,245,228,0.08)', fontSize: 14, color: '#fcf5e4', fontFamily: 'var(--font-fraunces), Georgia, serif', fontStyle: 'italic', outline: 'none' }}
                      onFocus={e => (e.target.style.borderColor = 'rgba(232,97,77,0.6)')}
                      onBlur={e => (e.target.style.borderColor = 'rgba(252,245,228,0.28)')}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 28, alignItems: 'center' }}>
                  {['all', 'recent'].map(t => (
                    <button key={t} onClick={() => setActiveTab(t)} style={{ padding: '7px 17px', border: `1.5px solid ${activeTab === t ? 'rgba(232,97,77,0.6)' : 'rgba(252,245,228,0.28)'}`, background: activeTab === t ? 'rgba(232,97,77,0.15)' : 'transparent', borderRadius: 9999, cursor: 'pointer', fontFamily: 'var(--font-dmsans)', fontWeight: 700, fontSize: 13, color: activeTab === t ? 'var(--coral)' : 'rgba(252,245,228,0.7)', letterSpacing: '0.02em', transition: 'all 160ms ease' }}>
                      {t}
                    </button>
                  ))}
                </div>
                {savedProjects && savedProjects.length === 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80, color: 'rgba(252,245,228,0.4)', fontFamily: 'var(--font-fraunces), Georgia, serif', fontStyle: 'italic', fontSize: 18 }}>
                    No saved projects yet!
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 28, marginTop: 24 }}>
                    {savedProjects?.map((p, i) => (
                      <div key={p._id} ref={el => { if (el) cardWrapRefs.current.set(p._id, el); else cardWrapRefs.current.delete(p._id); }}>
                        <ProjectCard
                          project={p}
                          onClick={() => onOpenProject(p)}
                          rotate={[-1.4, 0.8, -0.6, 1.2, -0.8][i % 5]}
                          onDelete={() => { snapshotForFlip(); removeProject({ projectId: p._id }); }}
                          onSave={(cardRect) => handleSaveProject(p, cardRect)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Gap band: Saved → Explore ── only visible during transition */}
              <div style={{ height: 320, flexShrink: 0, pointerEvents: 'none' }}>
                <svg viewBox="0 0 1440 320" preserveAspectRatio="none" style={{ width: '100%', height: 320, display: 'block' }}>
                  <rect width="1440" height="320" fill="#2b2e27" />
                  <path d="M0,320 L0,180 C240,70 480,290 720,180 C960,70 1200,290 1440,180 L1440,320 Z" fill="#fcf5e4" />
                </svg>
              </div>

              {/* Floor 2 — Explore */}
              <div style={{ height: vpH || '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 40px' }}>
                <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Image src="/stickynote.png" alt="" width={462} height={462} style={{ objectFit: 'contain', display: 'block' }} />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <svg
                      width="62"
                      height="62"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--ink)"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ animation: 'cog-turn 2.8s ease-in-out infinite', opacity: 0.6 }}
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    <p style={{ margin: 0, fontFamily: 'var(--font-jetbrains), ui-monospace, monospace', fontSize: 26, color: 'rgba(42,32,26,0.75)', textAlign: 'center', lineHeight: 1.2, fontWeight: 700, transform: 'translateY(8px)' }}>
                      Actively in<br />Development
                    </p>
                  </div>
                </div>
              </div>

            </div>
          </div>

          {flyingCard && (
            <FlyingCard
              fromRect={flyingCard.fromRect}
              toPoint={flyingCard.toPoint}
              thumbnailUrl={flyingCard.thumbnailUrl}
              onDone={() => setFlyingCard(null)}
            />
          )}
        </div>

      </div>
    </main>
  );
}

/* ─────────────── Scan result popup (after scan, before edit) ─────────────── */
function ScanResultPopup({
  imageUrl,
  onContinue,
}: { imageUrl: string; onContinue: () => void }) {
  const [interacting, setInteracting] = useState(false);
  const [rotation, setRotation] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientY - rect.top) / rect.height - 0.5) * 20;
    const y = ((e.clientX - rect.left) / rect.width - 0.5) * -20;
    setRotation({ x, y });
    setInteracting(true);
  };
  const handleMouseLeave = () => {
    setInteracting(false);
    setRotation({ x: 0, y: 0 });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="popup-in flex flex-col items-center gap-5">
        <div
          ref={containerRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{
            transition: interacting ? 'none' : 'transform 600ms cubic-bezier(.2,.85,.2,1)',
            transform: `perspective(600px) rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`,
            animation: interacting ? 'none' : undefined,
          }}
        >
          <div className="polaroid scan-pop-in" style={{ maxWidth: 280 }}>
            <div className="tape tape-tl" /><div className="tape tape-tr" />
            <img src={imageUrl} alt="Your scan" className="block w-full rounded-sm object-cover" style={{ aspectRatio: '1' }} />
            <div className="absolute bottom-3 left-0 right-0 text-center">
              <span className="font-display text-[var(--char)] text-lg" style={{ fontStyle: 'italic', fontWeight: 500 }}>
                you ✂
              </span>
            </div>
          </div>
        </div>
        <BouncyButton
          onClick={onContinue}
          className="btn btn-tomato"
          style={{ padding: '12px 28px', fontSize: 14 }}
        >
          ✂ Style it
        </BouncyButton>
      </div>
    </div>
  );
}

/* ─────────────── Circular spinner loader ─────────────── */
function FaceliftLoader({ demoStatus }: { demoStatus: string }) {
  const frozen = demoStatus === 'error';
  const r = 20;
  const circumference = 2 * Math.PI * r;
  const dashoffset = circumference * 0.75;

  return (
    <div className="flex flex-col items-center gap-3 p-8">
      <div
        style={{
          width: 48,
          height: 48,
          animation: frozen ? 'none' : 'spin 1.1s linear infinite',
          transformOrigin: 'center',
        }}
      >
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r={r} stroke="rgba(255,248,234,0.12)" strokeWidth="3" />
          <circle
            cx="24" cy="24" r={r}
            stroke={frozen ? 'rgba(255,248,234,0.25)' : 'var(--butter)'}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashoffset}
            transform="rotate(-90, 24, 24)"
          />
        </svg>
      </div>
      {frozen ? (
        <span className="font-mono text-[10px] text-[var(--butter)] opacity-85">Error — check console</span>
      ) : (
        <span className="font-serif italic text-xs text-[var(--cream)]" style={{ opacity: 0.5 }}>
          Building your 3D model…
        </span>
      )}
    </div>
  );
}

/* ─────────────── Demo toolbox sidebar ─────────────── */
interface DemoToolboxProps {
  profile: UserHeadProfile;
  prompt: string;
  onPromptChange: (v: string) => void;
  onSubmit: () => void;
}
function DemoToolbox({ profile, prompt, onPromptChange, onSubmit }: DemoToolboxProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); }
  };

  return (
    <div className="flex flex-col gap-6 px-5 py-6 h-full overflow-y-auto cozy-scroll text-[var(--ink)]" style={{ background: 'var(--biscuit-lt)' }}>
      <div className="flex items-center gap-3">
        <span className="inline-block w-2 h-7 barber-pole" />
        <div>
          <div className="font-sans text-[10px] uppercase tracking-wider text-[var(--smoke)]">The barber&rsquo;s</div>
          <h2 className="font-display italic text-2xl text-[var(--ink)] leading-none" style={{ fontWeight: 500 }}>Toolbox</h2>
        </div>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="pill pill-tomato">new request</span>
          <span className="font-mono text-[10px] text-[var(--smoke)]">✂</span>
        </div>
        <textarea
          className="input-soft w-full rounded-xl px-3 py-2 text-sm resize-none h-20 placeholder:text-[var(--smoke)]"
          style={{ fontStyle: 'italic' }}
          placeholder='"Messy taper fade, please."'
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="flex gap-2">
          <button type="submit" className="btn btn-tomato flex-1" style={{ padding: '10px 16px', fontSize: 13 }}>✂ Render in 3D</button>
          <button type="button" disabled className="btn btn-denim opacity-40 cursor-not-allowed" style={{ padding: '10px 14px', fontSize: 13 }}>🎙 Voice</button>
        </div>
      </form>

      <div className="flex flex-col gap-3 pt-4 border-t border-dashed border-[var(--char)]/20">
        <span className="pill pill-tomato">take it to your barber</span>
        <button disabled className="btn btn-cream opacity-40 cursor-not-allowed" style={{ padding: '10px 16px', fontSize: 13 }}>📜 Barber&rsquo;s order</button>
      </div>

      <div className="mt-auto pt-4 border-t border-dashed border-[var(--char)]/20 font-mono text-[10px] text-[var(--smoke)] flex items-center justify-between">
        <span>preset · <span className="text-[var(--ink)]">{profile.currentStyle.preset}</span></span>
        <span>type · <span className="text-[var(--ink)]">{profile.currentStyle.hairType}</span></span>
      </div>
    </div>
  );
}

/* ─────────────── Root ─────────────── */
const DEMO_STATUS_LABEL: Record<string, string> = {
  idle: 'Setting up...', processing: 'Building 3D model (~2 min)', done: 'All ready', error: 'Error — check console',
};

export default function Home() {
  const { isSignedIn } = useUser();
  const getOrCreate = useMutation(api.users.getOrCreate);
  const createProject = useMutation(api.projects.create);
  const saveProject = useMutation(api.projects.save);
  const meUser    = useQuery(api.users.getMe);
  const myProjects = useQuery(api.projects.list) as ProjectDoc[] | undefined;

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [paymentSuccess, setPaymentSuccess] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      setPaymentSuccess(true);
      const clean = window.location.pathname;
      window.history.replaceState({}, '', clean);
    }
  }, []);

  useEffect(() => {
    if (isSignedIn) {
      getOrCreate().catch((err) => console.error('[Home] getOrCreate FAILED:', err));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  const needsUsername = isSignedIn && meUser !== undefined && meUser !== null && !meUser.username;

  // Preload critical landing page images so loading screen stays up until they're ready
  const [landingAssetsReady, setLandingAssetsReady] = useState(false);
  useEffect(() => {
    const LANDING_IMAGES = [
      '/offwhitebg.png',
      '/blob.png',
      '/tape.png',
      '/landing_face2/face2_selfie.png',
      '/1.png',
      '/2.png',
      '/3.png',
    ];
    let loaded = 0;
    const onLoad = () => { if (++loaded === LANDING_IMAGES.length) setLandingAssetsReady(true); };
    LANDING_IMAGES.forEach(src => {
      const img = new window.Image();
      img.onload = onLoad;
      img.onerror = onLoad; // don't block on missing assets
      img.src = src;
    });
  }, []);

  // App state
  const [appState, setAppState] = useState<AppState>('landing');
  const [activeProjectId, setActiveProjectId] = useState<Id<'projects'> | null>(null);

  // Auto-enter dashboard when signed in (handles both OAuth redirect and in-popup sign-in)
  useEffect(() => {
    if (appState === 'landing' && isSignedIn) setAppState('home');
  }, [isSignedIn, appState]);

  // Return to landing page when signed out
  useEffect(() => {
    if (isSignedIn === false && appState !== 'landing') setAppState('landing');
  }, [isSignedIn, appState]);

  // Scan/hair state
  const [profile, setProfile]   = useState<UserHeadProfile | null>(null);
  const [params,  setParams]    = useState<HairParams>(mockUserHeadProfile.currentStyle.params);
  const [sessionId, setSessionId]   = useState<string | null>(null);
  const [imageUrl,  setImageUrl]    = useState<string | null>(null);
  const [hairstepPlyUrl, setHairstepPlyUrl] = useState<string | null>(null);
  const [editSplatSrc,   setEditSplatSrc]   = useState<string | null>(null);
  const [previewPlyUrl, setPreviewPlyUrl]   = useState<string | null>(null);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [editLoopPrompt, setEditLoopPrompt] = useState('');
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [sceneBackground, setSceneBackground] = useState('#001f5b');
  const [menuHidden, setMenuHidden] = useState(false);

  // Tracks whether + was clicked and no project has been created yet
  const [pendingNewProject, setPendingNewProject] = useState(false);
  // Splat URL restored when opening an existing project (S3, valid 7 days)
  const [persistedSplatUrl, setPersistedSplatUrl] = useState<string | null>(null);

  // UI state
  const [showScanPopup, setShowScanPopup]       = useState(false);
  const [showScanResult, setShowScanResult]     = useState(false);
  const [hasScanEver, setHasScanEver]           = useState(false);
  const [showSignInPopup, setShowSignInPopup]   = useState(false);
  const [selfieFlying, setSelfieFlying] = useState<{ url: string; fromRect: DOMRect; toRect: DOMRect } | null>(null);
  const [profilePillPulse, setProfilePillPulse] = useState(false);

  // Auto-open scan popup (in username phase) on first login before username is set
  useEffect(() => {
    if (appState === 'home' && needsUsername) {
      setShowScanPopup(true);
    }
  }, [appState, needsUsername]);


  // Auto-save project every 30s when in 3D studio
  useEffect(() => {
    if (appState !== '3d' || !activeProjectId || !imageUrl) return;
    const t = setInterval(async () => {
      try {
        await saveProject({
          projectId: activeProjectId,
          lastHairParams: params,
          lastProfile: profile ?? undefined,
          lastImageUrl: imageUrl ?? undefined,
        });
      } catch { /* silent */ }
    }, 30_000);
    return () => clearInterval(t);
  }, [appState, activeProjectId, params, profile, imageUrl, saveProject]);

  const smirk = useSmirk(undefined);
  // Only run useDemoFacelift as a fallback if we don't already have a splat from ScanPopup
  const { splatSrc, status: demoStatus } = useDemoFacelift(persistedSplatUrl ? null : imageUrl);

  // Effective splat URL: prefer the one from ScanPopup/project, fall back to useDemoFacelift
  const effectiveSplatUrl = persistedSplatUrl ?? splatSrc;

  console.log('[page] splat debug — persistedSplatUrl:', persistedSplatUrl, '| splatSrc (demo):', splatSrc, '| effectiveSplatUrl:', effectiveSplatUrl);

  // Persist the splat URL once facelift finishes (from either ScanPopup or useDemoFacelift fallback)
  useEffect(() => {
    const urlToSave = splatSrc ?? persistedSplatUrl;
    if (!urlToSave || !activeProjectId) return;
    if (splatSrc) setPersistedSplatUrl(splatSrc);
    saveProject({ projectId: activeProjectId, lastSplatUrl: urlToSave }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splatSrc, persistedSplatUrl, activeProjectId]);

  const handleParamsChange = useCallback((next: HairParams) => {
    setParams(next);
    setProfile(prev => prev ? {
      ...prev,
      currentStyle: { ...prev.currentStyle, params: next },
      measurementSnapshot: buildHairMeasurementSnapshot({
        source: 'derived_params',
        baselineMeasurements: prev.hairMeasurements,
        params: next,
        revision: (prev.measurementSnapshot?.revision ?? 0) + 1,
        bbox: prev.measurementSnapshot?.bbox,
      }),
    } : prev);
  }, []);

  const handleScanComplete = (p: UserHeadProfile, sid: string | null, url: string | null, fromRect?: DOMRect, isFirstScan?: boolean, splatUrl?: string) => {
    console.log('[handleScanComplete] splatUrl received:', splatUrl, '| isFirstScan:', isFirstScan);
    const profileWithMeasurements = ensureMeasurementSnapshot(p);
    setProfile(profileWithMeasurements);
    setParams(profileWithMeasurements.currentStyle.params);
    setHasScanEver(true);
    setShowScanPopup(false);

    if (splatUrl) {
      console.log('[handleScanComplete] calling setPersistedSplatUrl with:', splatUrl);
      setPersistedSplatUrl(splatUrl);
    }

    if (isFirstScan && url) {
      // First-time setup: don't open a session — animate the selfie into the profile button
      setSessionId(sid);
      setImageUrl(url);
      const profileEl = document.getElementById('profile-menu-pill');
      const toRect = profileEl?.getBoundingClientRect();
      if (fromRect && toRect) {
        setSelfieFlying({ url, fromRect, toRect });
      }
      return;
    }

    if (url) {
      setSessionId(sid);
      setImageUrl(url);
      setShowScanResult(true);
    } else {
      setAppState('3d');
    }
  };

  // Auto-load the most recent project for returning users so they skip re-scanning
  useEffect(() => {
    if (!isSignedIn || hasScanEver || !myProjects?.length) return;
    const latest = myProjects[0];
    if ((latest as { lastSplatUrl?: string })?.lastSplatUrl) handleOpenProject(latest);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, myProjects]);

  const handleHairBBoxReady = useCallback((bbox: RawHairBBox) => {
    setProfile(prev => prev ? {
      ...prev,
      measurementSnapshot: buildHairMeasurementSnapshot({
        source: 'mesh_bbox',
        baselineMeasurements: prev.hairMeasurements,
        params: prev.currentStyle.params,
        revision: (prev.measurementSnapshot?.revision ?? 0) + 1,
        bbox,
      }),
    } : prev);
  }, []);

  const handleDemoPromptSubmit = () => {
    if (!editLoopPrompt.trim()) return;
    setAppState('3d');
  };

  const handleAddProject = async () => {
    if (!isSignedIn) { setShowSignInPopup(true); return; }
    setPendingNewProject(true);
    setShowScanPopup(true);
  };

  const handleOpenProject = (project: ProjectDoc) => {
    setActiveProjectId(project._id);
    if (project.lastProfile) setProfile(project.lastProfile as UserHeadProfile);
    if (project.lastHairParams) setParams(project.lastHairParams as HairParams);
    if (project.lastImageUrl) setImageUrl(project.lastImageUrl);
    // Restore saved splat and clear any leftover local splat from a previous session
    setPersistedSplatUrl((project as { lastSplatUrl?: string }).lastSplatUrl ?? null);
    setEditSplatSrc(null);
    setAppState('3d');
  };

  // ── Waitlist gate ──
  const isWaitlistMode = process.env.NEXT_PUBLIC_WAITLIST_MODE === '1';
  const isTargetDomain = mounted && (
    window.location.hostname === 'nomorebadhaircuts.com' ||
    window.location.hostname === 'www.nomorebadhaircuts.com' ||
    process.env.NODE_ENV === 'development'
  ) && window.location.hostname !== 'dev.nomorebadhaircuts.com';
  if (isWaitlistMode && !mounted) return null;
  if (isWaitlistMode && isTargetDomain) return <WaitlistPage />;

  // ─────────────── LOADING ───────────────
  if (appState === 'loading') {
    return <LoadingScreen onDone={() => setAppState('landing')} ready={landingAssetsReady} />;
  }

  // ─────────────── LANDING ───────────────
  if (appState === 'landing') {
    return <LandingPage onEnter={() => setAppState('home')} />;
  }

  // ─────────────── HOME / MAIN MENU ───────────────
  if (appState === 'home') {
    return (
      <>
        <MainMenu
          onAdd={handleAddProject}
          onOpenProject={handleOpenProject}
          showScanNow={!hasScanEver}
          onScanNow={() => setShowScanPopup(true)}
          onRescan={() => setShowScanPopup(true)}
          onSignIn={() => setShowSignInPopup(true)}
          profilePillPulse={profilePillPulse}
          celebratePurchase={paymentSuccess}
        />

        {/* Sign-in popup */}
        {showSignInPopup && (
          <SignInPopup onDismiss={() => setShowSignInPopup(false)} />
        )}

        {/* Camera scan popup */}
        {showScanPopup && (
          <ScanPopup
            onScanComplete={handleScanComplete}
            onDismiss={() => setShowScanPopup(false)}
            needsUsername={needsUsername}
          />
        )}

        {/* Scan result popup (non-initial scans) */}
        {showScanResult && imageUrl && (
          <ScanResultPopup
            imageUrl={imageUrl}
            onContinue={() => { setShowScanResult(false); setAppState('hairEditLoop'); }}
          />
        )}

        {/* First-scan selfie fly animation */}
        {selfieFlying && (
          <SelfieFlyOverlay
            url={selfieFlying.url}
            fromRect={selfieFlying.fromRect}
            toRect={selfieFlying.toRect}
            onDone={() => {
              setSelfieFlying(null);
              setProfilePillPulse(true);
              setTimeout(() => setProfilePillPulse(false), 800);
            }}
          />
        )}
      </>
    );
  }

  // ─────────────── HAIR EDIT LOOP ───────────────
  if (appState === 'hairEditLoop' && imageUrl) {
    const faceliftReady = effectiveSplatUrl != null;
    console.log('[page] hairEditLoop — faceliftReady:', faceliftReady, 'effectiveSplatUrl:', effectiveSplatUrl);
    return (
      <main className="flex fixed inset-0 overflow-hidden bg-tomato-shop">
        <div className="absolute top-5 left-6 z-20">
          <InlineWordmark cream small />
        </div>

        <div className="flex-1 min-w-0 relative">
          {faceliftReady ? (
            <HairScene
              params={params}
              colorRGB={profile?.currentStyle.colorRGB ?? '#3b1f0a'}
              profile={profile ?? mockUserHeadProfile}
              splatSrcOverride={effectiveSplatUrl}
              disableDefaultHairLayers
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-8 p-8">
              <div
                className={`polaroid ${previewExpanded ? '' : 'wonky-sm-l'}`}
                style={{
                  width: '100%',
                  maxWidth: previewExpanded ? 'min(60vh, 54vw)' : '340px',
                  transition: 'max-width 0.4s cubic-bezier(0.34, 1.2, 0.64, 1), transform 0.4s cubic-bezier(0.34, 1.2, 0.64, 1)',
                  cursor: previewExpanded ? 'zoom-out' : 'zoom-in',
                }}
                onClick={() => setPreviewExpanded(v => !v)}
              >
                <div className="tape tape-tl" />
                <div className="tape tape-tr" />
                <div className="relative overflow-hidden rounded-sm" style={{ background: '#1c1510', aspectRatio: '1' }}>
                  <Image src={imageUrl} alt="Your scan" fill className="object-cover" unoptimized />
                </div>
                <div className="absolute bottom-3 left-0 right-0 text-center">
                  <span className="font-display text-[var(--char)] text-lg" style={{ fontStyle: 'italic', fontWeight: 500 }}>you ✂</span>
                </div>
              </div>
              <FaceliftLoader demoStatus={demoStatus} />
            </div>
          )}
        </div>

        <aside className="w-80 flex-shrink-0 flex flex-col p-4 gap-4 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--cream)]">the toolbox</span>
            <div className="flex items-center gap-2">
              <button disabled className="btn-ink opacity-40 cursor-not-allowed" style={{ padding: '6px 12px', fontSize: 10 }}>✦ Recommend</button>
              <button disabled className="btn-ink opacity-40 cursor-not-allowed" style={{ padding: '6px 12px', fontSize: 10 }}>✂ Start over</button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden rounded-2xl" style={{ background: 'var(--biscuit-lt)', border: '1px solid rgba(42,32,26,0.1)', boxShadow: '0 30px 60px -24px rgba(0,0,0,0.45)' }}>
            <DemoToolbox
              profile={profile ?? mockUserHeadProfile}
              prompt={editLoopPrompt}
              onPromptChange={setEditLoopPrompt}
              onSubmit={handleDemoPromptSubmit}
            />
          </div>
        </aside>
      </main>
    );
  }

  // ─────────────── 3D STUDIO ───────────────
  return (
    <main className="flex fixed inset-0 overflow-hidden bg-tomato-shop">
      <div className="absolute top-5 left-6 z-20">
        <InlineWordmark cream small />
      </div>

      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none text-center">
        <h2 className="type-chonk text-[var(--cream)]" style={{ fontSize: 'clamp(2.2rem, 5vw, 4rem)', opacity: 0.96 }}>
          THE <em style={{ color: 'var(--butter)' }}>studio</em>
        </h2>
      </div>

      <div className="flex-1 min-w-0 relative flex items-center justify-center p-6 pt-24">
        {imageUrl && (
          <div
            className={`absolute top-24 left-6 z-10 polaroid ${previewExpanded ? '' : 'wonky-l'}`}
            style={{
              width: previewExpanded ? 'min(55vh, 46vw)' : 100,
              padding: '6px 6px 22px',
              transition: 'width 0.4s cubic-bezier(0.34, 1.2, 0.64, 1)',
              cursor: previewExpanded ? 'zoom-out' : 'zoom-in',
            }}
            onClick={() => setPreviewExpanded(v => !v)}
          >
            <div style={{ aspectRatio: '1', overflow: 'hidden', borderRadius: 2 }}>
              <img src={imageUrl} alt="scan" className="block w-full h-full object-cover" />
            </div>
            <div className="absolute bottom-1 inset-x-0 text-center font-display text-[var(--char)] text-sm" style={{ fontStyle: 'italic', fontWeight: 500 }}>
              you
            </div>
          </div>
        )}

        <div
          className="relative w-full h-full rounded-3xl overflow-hidden"
          style={{ background: 'linear-gradient(180deg, #241a14 0%, #17110d 100%)', border: '1px solid rgba(255,248,234,0.12)', boxShadow: '0 40px 80px -30px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,248,234,0.08)' }}
        >
          <div className="absolute top-3 right-3 z-10">
            <HairRecommendationsBar visible={showRecommendations} onHover={setPreviewPlyUrl} onSelect={(url) => { setHairstepPlyUrl(url); setPreviewPlyUrl(null); }} />
          </div>

          <HairScene
            params={params}
            colorRGB={profile?.currentStyle.colorRGB ?? '#3b1f0a'}
            profile={profile ?? mockUserHeadProfile}
            onPrimaryHairBBoxReady={handleHairBBoxReady}
            hairstepPlyUrl={previewPlyUrl ?? hairstepPlyUrl ?? undefined}
            splatSrcOverride={editSplatSrc ?? effectiveSplatUrl ?? undefined}
            disableDefaultHairLayers={!!(editSplatSrc ?? effectiveSplatUrl)}
            background={sceneBackground}
            uiHidden={menuHidden}
            flameData={
              smirk.result
                ? {
                    vertices: smirk.result.vertices_canonical,
                    faces: smirk.result.faces,
                  }
                : undefined
            }
          />

          {/* Scene controls overlay */}
          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between z-10">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--cream)]/70 pointer-events-none">live · 3d sculpt</span>
            <div className="flex items-center gap-2">
              {['#001f5b', '#000000', '#1c1510', '#00b140', '#f5f0e8'].map(c => (
                <button
                  key={c}
                  onClick={() => setSceneBackground(c)}
                  style={{
                    width: 13, height: 13, borderRadius: '50%', cursor: 'pointer',
                    background: c,
                    border: sceneBackground === c ? '2px solid rgba(255,248,234,0.9)' : '1px solid rgba(255,248,234,0.25)',
                    flexShrink: 0,
                  }}
                />
              ))}
              <input
                type="color"
                value={sceneBackground}
                onChange={e => setSceneBackground(e.target.value)}
                title="Custom background color"
                style={{ width: 16, height: 16, padding: 0, border: 'none', cursor: 'pointer', borderRadius: 3, background: 'none', flexShrink: 0 }}
              />
              <button
                onClick={() => setMenuHidden(v => !v)}
                className="font-mono text-[9px] uppercase tracking-[0.18em] hover:text-[var(--cream)]"
                style={{ color: 'rgba(255,248,234,0.55)', background: 'rgba(0,0,0,0.35)', borderRadius: 4, padding: '3px 8px' }}
              >
                {menuHidden ? 'show ui' : 'hide ui'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Sidebar — cream card floating on red */}
      {!menuHidden && <aside className="w-80 flex-shrink-0 flex flex-col p-4 gap-4 relative overflow-hidden">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--cream)]">the toolbox</span>
          <div className="flex items-center gap-2">
            <BouncyButton onClick={() => setShowRecommendations(true)} className="btn-ink" style={{ padding: '6px 12px', fontSize: 10 }}>✦ Recommend</BouncyButton>
            <BouncyButton onClick={() => setAppState('home')} className="btn-ink" style={{ padding: '6px 12px', fontSize: 10 }}>✂ Home</BouncyButton>
          </div>
        </div>
        <div className="flex-1 overflow-hidden rounded-2xl" style={{ background: 'var(--biscuit-lt)', border: '1px solid rgba(42,32,26,0.1)', boxShadow: '0 30px 60px -24px rgba(0,0,0,0.45)' }}>
          <EditPanel
            profile={profile ?? mockUserHeadProfile}
            onParamsChange={handleParamsChange}
            sessionId={sessionId}
            latestImageUrl={imageUrl}
            onImageUpdated={(url) => { setImageUrl(url); setPreviewExpanded(false); }}
            onPlyReady={(url) => {
              if (url.startsWith('/')) { setEditSplatSrc(url); }
              else { setHairstepPlyUrl(`/api/proxy-ply?url=${encodeURIComponent(url)}`); }
            }}
            onUncertain={() => setShowRecommendations(true)}
          />
        </div>
      </aside>}
    </main>
  );
}
