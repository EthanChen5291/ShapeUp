'use client';

import { HairMeasurementBBox, HairParams, UserHeadProfile } from '@/types';
import { buildHairMeasurementSnapshot, ensureMeasurementSnapshot } from '@/lib/hairMeasurementSnapshot';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useClerk, useUser } from '@clerk/nextjs';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { Id } from '@convex/_generated/dataModel';

import EditPanel from '@/components/EditPanel';
import { WaitlistPage } from '@/components/WaitlistPage';
import Image from 'next/image';
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
function ProfileMenu({ onRescan, pulse = false }: { onRescan: () => void; pulse?: boolean }) {
  const { user: clerkUser, isSignedIn } = useUser();
  const { openSignIn, signOut } = useClerk();
  const userQuery = useQuery(api.users.getMe);
  const [open, setOpen] = useState(false);
  const [bouncing, setBouncing] = useState(false);
  const [swallowing, setSwallowing] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsOriginRect, setSettingsOriginRect] = useState<DOMRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pulse) return;
    setSwallowing(true);
    const t = setTimeout(() => setSwallowing(false), 700);
    return () => clearTimeout(t);
  }, [pulse]);
  const stableUserRef = useRef(userQuery);
  if (userQuery != null) stableUserRef.current = userQuery;
  const user = stableUserRef.current;

  if (!isSignedIn) {
    return (
      <BouncyButton onClick={() => openSignIn()} className="btn" style={{ padding: '9px 18px', fontSize: 11, background: 'var(--coral)', color: 'var(--offwhite)', border: 'none' }}>
        Sign in
      </BouncyButton>
    );
  }

  const username = user?.username ?? clerkUser?.firstName ?? clerkUser?.emailAddresses?.[0]?.emailAddress?.split('@')[0] ?? 'You';

  const handleToggle = () => setOpen(o => !o);

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
      className={`relative z-50 ${bouncing ? 'profile-pill-bounce' : ''} ${swallowing ? 'profile-pill-swallow' : ''}`}
    >
      {/* Pill header */}
      <button
        onClick={handleToggle}
        className="flex items-center gap-2 px-3 py-2"
        style={{
          background: 'var(--cream)',
          border: '1px solid rgba(42,32,26,0.12)',
          backdropFilter: 'blur(8px)',
          borderRadius: 40,
          width: 176,
          cursor: 'pointer',
          boxShadow: open ? '0 4px 16px -4px rgba(0,0,0,0.15)' : 'none',
          transition: 'box-shadow 300ms ease',
        }}
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

      {/* Dropdown overlay — absolutely positioned so it doesn't shift layout */}
      <div style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        width: 290,
        background: 'var(--cream)',
        border: '1px solid rgba(42,32,26,0.12)',
        backdropFilter: 'blur(8px)',
        borderRadius: 18,
        boxShadow: '0 20px 50px -12px rgba(0,0,0,0.25)',
        overflow: 'hidden',
        maxHeight: open ? '420px' : '0px',
        opacity: open ? 1 : 0,
        pointerEvents: open ? 'auto' : 'none',
        transition: open
          ? 'max-height 400ms cubic-bezier(.08,.82,.17,1), opacity 250ms 80ms ease'
          : 'max-height 280ms cubic-bezier(.4,0,1,1), opacity 150ms ease',
      }}>
        <div className="px-4 pb-4 flex flex-col gap-3" style={{ paddingTop: 12 }}>

          {/* Tokens */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[12px] uppercase tracking-wider text-[var(--smoke)]">Tokens</span>
              <span className="font-sans text-[17px] text-[var(--ink)]" style={{ fontWeight: 700 }}>
                {user?.credits ?? 0}
              </span>
            </div>
            <BouncyButton
              onClick={() => setShowPricing(true)}
              className="btn btn-cream w-full"
              style={{ padding: '9px 16px', fontSize: 12, letterSpacing: '0.06em', fontWeight: 700, boxShadow: 'none', border: '1px solid rgba(42,32,26,0.12)' }}
            >
              Get more!
            </BouncyButton>
          </div>

          <div className="border-t border-dashed border-[var(--char)]/15 pt-2 flex items-center justify-between">
            <BouncyButton
              onClick={handleOpenSettings}
              className="font-sans text-[var(--smoke)] hover:text-[var(--ink)] transition-colors"
              style={{ background: 'none', border: 'none', padding: '4px 2px', lineHeight: 1 }}
            >
              <span style={{ fontSize: 28, display: 'block', lineHeight: 1 }}>⚙</span>
            </BouncyButton>
            <BouncyButton
              onClick={() => { setOpen(false); signOut(); }}
              className="font-sans text-[13px] uppercase tracking-wider text-[var(--smoke)] hover:text-[var(--tomato)] transition-colors"
              style={{ background: 'none', border: 'none', paddingRight: 2 }}
            >
              Sign out
            </BouncyButton>
          </div>
        </div>
      </div>

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
// Bars run in parallel from their startDelay. Timeline:
//   Bar 1 finishes ~7.5 s  (delay 0)
//   Bar 2 finishes ~16.5 s (delay 1800)
//   Bar 3 finishes ~26 s   (delay 5000)
//   Bar 4 hits 88% ~29 s   (delay 9000) then holds until facelift returns
type BarSegment = { to: number; ms: number } | { hold: number };

const SCAN_STEPS: { label: string; delay: number; holdAt88: boolean; segments: BarSegment[] }[] = [
  {
    label: 'Scanning geometry', delay: 0, holdAt88: false,
    segments: [
      { to: 28, ms: 1600 }, { hold: 1000 },
      { to: 64, ms: 2200 }, { hold: 700 },
      { to: 100, ms: 2000 },
    ],
  },
  {
    label: 'Mapping features', delay: 1800, holdAt88: false,
    segments: [
      { to: 16, ms: 1800 }, { hold: 2200 },
      { to: 44, ms: 3000 }, { hold: 1400 },
      { to: 78, ms: 3200 }, { hold: 900 },
      { to: 100, ms: 2200 },
    ],
  },
  {
    label: 'Generating mesh', delay: 5000, holdAt88: false,
    segments: [
      { to: 11, ms: 2000 }, { hold: 2800 },
      { to: 34, ms: 3500 }, { hold: 1800 },
      { to: 62, ms: 4000 }, { hold: 1500 },
      { to: 86, ms: 3000 }, { hold: 600 },
      { to: 100, ms: 2000 },
    ],
  },
  {
    label: 'Building model', delay: 9000, holdAt88: true,
    segments: [
      { to: 19, ms: 2500 }, { hold: 3500 },
      { to: 47, ms: 4500 }, { hold: 2500 },
      { to: 88, ms: 6500 },
    ],
  },
];

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function OrganicBar({ label, startDelay = 0, segments, holdAt88 = false, complete = false }: {
  label: string; startDelay?: number; segments: BarSegment[]; holdAt88?: boolean; complete?: boolean;
}) {
  const [visible, setVisible]       = useState(startDelay === 0);
  const [fillPct, setFillPct]       = useState(0);
  const [completing, setCompleting] = useState(false);
  const rafRef      = useRef<number>(0);
  const holdRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepRef     = useRef(0);
  const stepStartRef = useRef(0);
  const fromPctRef  = useRef(0);

  useEffect(() => {
    if (startDelay === 0) return;
    const t = setTimeout(() => setVisible(true), startDelay);
    return () => clearTimeout(t);
  }, [startDelay]);

  useEffect(() => {
    if (!visible) return;
    stepRef.current = 0;
    stepStartRef.current = performance.now();
    fromPctRef.current = 0;

    const advance = (now: number) => {
      const seg = segments[stepRef.current];
      if (!seg) return;

      if ('hold' in seg) {
        // Use a timeout for the hold so we don't burn RAF frames doing nothing
        holdRef.current = setTimeout(() => {
          stepRef.current++;
          stepStartRef.current = performance.now();
          rafRef.current = requestAnimationFrame(advance);
        }, seg.hold);
        return;
      }

      const elapsed = now - stepStartRef.current;
      const t = Math.min(elapsed / seg.ms, 1);
      const pct = fromPctRef.current + easeInOut(t) * (seg.to - fromPctRef.current);
      setFillPct(pct);

      if (t >= 1) {
        fromPctRef.current = seg.to;
        stepRef.current++;
        stepStartRef.current = now;
        if (stepRef.current < segments.length) {
          rafRef.current = requestAnimationFrame(advance);
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
    if (!complete || !holdAt88) return;
    cancelAnimationFrame(rafRef.current);
    if (holdRef.current) clearTimeout(holdRef.current);
    setCompleting(true);
    setFillPct(100);
  }, [complete, holdAt88]);

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
  const { openSignIn } = useClerk();
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
    { id: 'lifetime', label: 'Lifetime haircut generations', price: '$29.99', featured: false },
  ] as const;

  const handleBuy = async (planId: string) => {
    if (!isSignedIn) { openSignIn(); return; }
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
              You&rsquo;re out of tokens. Pick a plan to keep styling.
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

          {/* Perks animation area — blank placeholder, revealed on expand */}
          <div
            style={{
              width: '100%',
              overflow: 'hidden',
              maxHeight: containerExpanded ? 200 : 0,
              opacity: containerExpanded ? 1 : 0,
              borderRadius: 16,
              background: 'rgba(42,32,26,0.04)',
              border: '1px solid rgba(42,32,26,0.08)',
              transition: `max-height 700ms ${ease} 150ms, opacity 500ms ${ease} 300ms`,
            }}
          >
            <div style={{ height: 180 }} />
          </div>
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
        if (data.status === 'success') { splatUrl = data.splatUrl!; break; }
        if (data.status === 'error') throw new Error(data.error ?? '3D build failed');
      }

      if (!splatUrl || abort.signal.aborted) return;

      setFaceliftStatus('done');
      setTimeout(() => {
        if (isDismissing.current) return;
        isDismissing.current = true;
        const fromRect = panelRef.current?.getBoundingClientRect() ?? undefined;
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
                {SCAN_STEPS.map((s) => (
                  <OrganicBar
                    key={s.label}
                    label={s.label}
                    startDelay={s.delay}
                    segments={s.segments}
                    holdAt88={s.holdAt88}
                    complete={s.holdAt88 ? faceliftStatus === 'done' : undefined}
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
}

function ProjectCard({
  project,
  onClick,
  rotate = 0,
}: { project: ProjectDoc; onClick: () => void; rotate?: number }) {
  const [zooming, setZooming] = useState(false);

  const handleClick = () => {
    setZooming(true);
    setTimeout(onClick, 480);
  };

  return (
    <BouncyButton
      onClick={handleClick}
      className={`relative rounded-2xl overflow-hidden flex flex-col text-left transition-shadow hover:shadow-xl ${zooming ? 'project-zoom' : ''}`}
      style={{
        background: 'var(--cream)',
        border: '1px solid rgba(42,32,26,0.1)',
        aspectRatio: '3/4',
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
        transition: 'transform 200ms ease, box-shadow 200ms ease',
        boxShadow: '0 8px 24px -8px rgba(0,0,0,0.18)',
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
        <span className="font-sans text-[11px] text-[var(--cream)] font-600" style={{ fontWeight: 600 }}>
          {project.name}
        </span>
      </div>
    </BouncyButton>
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
  const showText  = isEmpty && animPhase !== 'pre';

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
          border: '1px dashed rgba(42,32,26,0.15)',
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

      {showText && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            pointerEvents: 'none',
            zIndex: 10,
            animation: isFalling
              ? 'empty-text-drop 1.2s cubic-bezier(.4,0,.7,1) both'
              : isImpact
              ? 'empty-impact-shared 3.4s linear both'
              : 'none',
          }}
        >
          <span
            style={{
              fontSize: 19,
              color: 'var(--ink)',
              fontFamily: 'var(--font-sans)',
              fontWeight: 700,
              opacity: 0.9,
              whiteSpace: 'nowrap',
            }}
          >
            Start styling yourself in 3D
          </span>
        </div>
      )}
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
const FACE_VIDS = ['a','b','c','d','e','f'].map(l => `/landing_face1/face1${l}.mov`);

function FaceVideoSwiper({ onSwipeUp, onSwipeDown, scrollRef }: { onSwipeUp?: () => void; onSwipeDown?: () => void; scrollRef?: React.MutableRefObject<{ goNext: () => void; goPrev: () => void } | null> }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const activeRef   = useRef(0);
  const videoRefs   = useRef<(HTMLVideoElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const wheelLock   = useRef(false);
  const onSwipeUpRef = useRef(onSwipeUp);
  const onSwipeDownRef = useRef(onSwipeDown);
  useEffect(() => { onSwipeUpRef.current = onSwipeUp; }, [onSwipeUp]);
  useEffect(() => { onSwipeDownRef.current = onSwipeDown; }, [onSwipeDown]);

  const switchTo = useCallback((newIdx: number) => {
    const cur  = videoRefs.current[activeRef.current];
    const next = videoRefs.current[newIdx];
    if (cur && next) {
      next.currentTime = cur.currentTime;
      next.play().catch(() => {});
    }
    activeRef.current = newIdx;
    setActiveIdx(newIdx);
  }, []);

  const goNext = useCallback(() => { switchTo((activeRef.current + 1) % FACE_VIDS.length); onSwipeUpRef.current?.(); }, [switchTo]);
  const goPrev = useCallback(() => { switchTo((activeRef.current - 1 + FACE_VIDS.length) % FACE_VIDS.length); onSwipeDownRef.current?.(); }, [switchTo]);

  useEffect(() => {
    if (scrollRef) scrollRef.current = { goNext, goPrev };
  }, [scrollRef, goNext, goPrev]);

  // Native wheel listener with { passive: false } so we can preventDefault
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        wheelLock.current = false;
        idleTimer = null;
      }, 80);
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
              loop
              muted
              autoPlay
              playsInline
              preload="auto"
              style={{
                position: 'absolute',
                top: 0, left: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                opacity: i === activeIdx ? 1 : 0,
                transition: 'opacity 60ms ease',
                transform: i === 0 || i === 2 ? 'scale(0.93)' : i === 3 ? 'scale(0.97)' : undefined,
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

  const SH = 94;
  const SW = 170;
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

/* ─────────────── Glimpse / Orbit Section ─────────────── */
const GLIMPSE_SATELLITE_COUNT = 6;
const GLIMPSE_FINAL_RADIUS = 220;
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
    <section style={{ padding: '140px 0 180px', textAlign: 'center', position: 'relative' }}>
      {/* Headline */}
      <h2
        className="font-serif"
        style={{ fontSize: 'clamp(1.9rem, 3.6vw, 3rem)', color: 'var(--ink)', marginBottom: 100, lineHeight: 1.25, letterSpacing: '-0.01em' }}
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
        style={{ position: 'relative', height: 660, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {/* Center image */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 196,
            height: 196,
            marginLeft: -98,
            marginTop: -98,
            borderRadius: 26,
            overflow: 'hidden',
            background: 'var(--biscuit)',
            border: '2px solid rgba(42,32,26,0.12)',
            boxShadow: '0 24px 60px -12px rgba(0,0,0,0.22), 0 4px 12px -4px rgba(0,0,0,0.1)',
            zIndex: 2,
            // spring bounce: overshoots 1.08x then settles
            transform: centerVisible ? 'scale(1)' : 'scale(0)',
            transition: centerVisible ? 'transform 680ms cubic-bezier(0.34, 1.56, 0.64, 1)' : 'none',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              background: 'linear-gradient(145deg, var(--peach) 0%, var(--butter) 55%, var(--biscuit) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div style={{ width: 44, opacity: 0.22, transform: 'rotate(186deg)' }}>
              <BarberMascot isStatic />
            </div>
          </div>
        </div>

        {/* Satellite video placeholders */}
        {Array.from({ length: GLIMPSE_SATELLITE_COUNT }).map((_, i) => (
          <div
            key={i}
            ref={el => { satelliteRefs.current[i] = el; }}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 88,
              height: 116,
              transform: 'translate(-50%, -50%) scale(0)',
              opacity: 0,
              borderRadius: 14,
              overflow: 'hidden',
              background: PALETTE[i],
              border: '1.5px solid rgba(42,32,26,0.09)',
              boxShadow: '0 8px 28px -6px rgba(0,0,0,0.18)',
              zIndex: 1,
              willChange: 'transform, opacity',
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(42,32,26,0.28)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────────── Landing Page ─────────────── */
function LandingPage({ onEnter }: { onEnter: () => void }) {
  const { openSignIn } = useClerk();
  const swipeTriggerRef = useRef<((dir: 'up' | 'down') => void) | null>(null);
  const faceScrollRef = useRef<{ goNext: () => void; goPrev: () => void } | null>(null);
  return (
    <main
      className="relative min-h-screen overflow-x-hidden"
      style={{
        backgroundImage: 'url(/offwhitebg.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center top',
      }}
    >
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

      <div className="relative z-10" style={{ maxWidth: 1320, margin: '0 auto', padding: '28px 56px 0' }}>

        {/* ── Nav ── */}
        <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28 }}><BarberMascot isStatic color="#2a201a" /></div>
            <div className="type-chonk" style={{ fontSize: 30, lineHeight: 1, margin: 0, color: 'var(--ink)' }}>
              shape<em style={{ color: 'var(--tomato)' }}>up</em>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 32, color: 'var(--char)' }}>
            {['how it works', 'features', 'cuts', 'reviews', 'faq'].map(l => (
              <a
                key={l}
                href="#"
                className="font-serif italic"
                style={{ color: 'inherit', textDecoration: 'none', fontSize: 16, fontStyle: 'italic', opacity: 0.85, transition: 'opacity 140ms ease' }}
                onMouseEnter={e => ((e.target as HTMLElement).style.opacity = '1')}
                onMouseLeave={e => ((e.target as HTMLElement).style.opacity = '0.85')}
              >
                {l}
              </a>
            ))}
          </div>
          <button
            className="btn-ink"
            onClick={() => openSignIn()}
            style={{ padding: '11px 20px', fontSize: 13, borderRadius: 10, display: 'inline-flex', alignItems: 'center' }}
          >
            sign in
          </button>
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
            <div
              className="type-chonk"
              style={{ fontSize: 'clamp(2rem, 3.8vw, 3rem)', marginTop: 36, color: 'var(--ink)', lineHeight: 1.05 }}
            >
              <div>see it first.</div>
              <div>love it more.</div>
            </div>

            <p
              className="font-serif italic"
              style={{ fontSize: 18, color: 'var(--char)', maxWidth: 480, marginTop: 22, lineHeight: 1.5 }}
            >
              Preview any cut in 3D before you sit down.
              <br />No more guesswork. No more regrets.
            </p>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22, marginTop: 34 }}>
              <BouncyButton
                onClick={onEnter}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', position: 'relative', display: 'inline-block' }}
              >
                <Image src="/previewbutton.png" alt="preview your cut" width={431} height={126} style={{ height: 'auto', maxWidth: 364, display: 'block' }} />
                <span
                  className="font-sans"
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '45%',
                    transform: 'translate(-50%, -50%) rotate(-4deg)',
                    fontSize: 23,
                    fontWeight: 700,
                    color: '#ffffff',
                    letterSpacing: '0.01em',
                    pointerEvents: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  preview your cut
                </span>
              </BouncyButton>
            </div>
          </div>

          {/* Right — blob visual */}
          <div
            style={{ position: 'relative', height: 640, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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
              <Image
                src="/tape.png"
                alt=""
                width={308}
                height={157}
                style={{
                  position: 'absolute',
                  bottom: -72.6,
                  right: 91.04,
                  width: 405.6,
                  height: 183,
                  transform: 'rotate(10deg)',
                  transformOrigin: 'center center',
                  zIndex: 3,
                }}
              />
            </div>
          </div>
        </div>

        {/* ── Steps ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, marginTop: 72, paddingBottom: 'calc((100% / 3) * 0.25)' }}>
          {[
            { src: '/scanbutton.png', alt: 'Step 1: Scan', w: 488, h: 244, delay: 'delay-100' },
            { src: '/describebutton.png', alt: 'Step 2: Describe', w: 485, h: 244, delay: 'delay-200' },
            { src: '/showbarberbutton.png', alt: 'Step 3: Show your barber', w: 534, h: 244, delay: 'delay-300' },
          ].map(s => (
            <div key={s.src} className={`anim-fade-up ${s.delay}`}>
              <Image src={s.src} alt={s.alt} width={s.w} height={s.h} style={{ width: '100%', height: 'auto', transform: 'translateY(50%)' }} />
            </div>
          ))}
        </div>

        {/* ── Footer strip ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr 1fr',
            gap: 24,
            padding: '40px 0 44px',
            marginTop: 32,
            borderTop: '1px solid rgba(42,32,26,0.08)',
            alignItems: 'center',
          }}
        >
          {[
            { icon: '✂', label: 'A HAIRCUT,\nCONSIDERED.' },
            { icon: '🌐', label: 'BUILT FOR REAL PEOPLE.\nMADE FOR REAL LIFE.' },
            { icon: '✌', label: 'LOOK BETTER.\nFEEL UNSTOPPABLE.' },
          ].map(f => (
            <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ fontSize: 20, color: 'var(--ink)', flexShrink: 0 }}>{f.icon}</span>
              <span
                className="font-sans"
                style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--char)', lineHeight: 1.45, whiteSpace: 'pre-line', opacity: 0.75 }}
              >
                {f.label}
              </span>
            </div>
          ))}
          <div style={{ textAlign: 'right' }}>
            <span className="font-serif italic" style={{ fontSize: 26, color: 'var(--ink)', fontStyle: 'italic' }}>Shape Up</span>
            <sup className="font-sans" style={{ fontSize: 10, marginLeft: 3, verticalAlign: 'super', color: 'var(--char)' }}>™</sup>
          </div>
        </div>

        {/* ── Glimpse orbit section ── */}
        <GlimpseSection />

      </div>
    </main>
  );
}

/* ─────────────── Dashboard stat pill ─────────────── */
function DashStat({ icon, top, bottom }: { icon: React.ReactNode; top: string; bottom: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <span style={{ color: 'rgba(42,32,26,0.45)', fontSize: 18 }}>{icon}</span>
      <div style={{ lineHeight: 1.15 }}>
        <div className="font-mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'rgba(42,32,26,0.45)', textTransform: 'uppercase' }}>{top}</div>
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
  profilePillPulse = false,
}: {
  onAdd: () => void;
  onOpenProject: (project: ProjectDoc) => void;
  showScanNow: boolean;
  onScanNow: () => void;
  onRescan: () => void;
  profilePillPulse?: boolean;
}) {
  const projects = useQuery(api.projects.list) as ProjectDoc[] | undefined;
  const [menuVisible, setMenuVisible] = useState(false);
  const [logoVisible, setLogoVisible] = useState(false);
  const [rightVisible, setRightVisible] = useState(false);
  const [activeNav, setActiveNav] = useState('home');
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

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
      key: 'explore',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L22 22" />
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
      key: 'studio',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="6" cy="17" r="3" /><circle cx="6" cy="7" r="3" />
          <path d="M9 8.5L20 17" /><path d="M9 15.5L20 7" /><path d="M12 12H15" />
        </svg>
      ),
    },
    {
      key: 'settings',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2V5M12 19V22M2 12H5M19 12H22M4.22 4.22L6.34 6.34M17.66 17.66L19.78 19.78M4.22 19.78L6.34 17.66M17.66 6.34L19.78 4.22" />
        </svg>
      ),
    },
  ];

  return (
    <main className="relative overflow-hidden" style={{ minHeight: '100vh', background: 'var(--biscuit-lt)' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '88px 1fr',
          minHeight: '100vh',
          opacity: menuVisible ? 1 : 0,
          transition: 'opacity 400ms ease',
        }}
      >

        {/* ── LEFT NAV RAIL ── */}
        <aside
          style={{
            borderRight: '1px solid rgba(42,32,26,0.08)',
            background: 'var(--biscuit)',
            padding: '24px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            alignItems: 'center',
            zIndex: 2,
          }}
        >
          {/* Scissor mascot wordmark */}
          <div style={{ marginBottom: 24, width: 30, transform: 'rotate(186deg)', opacity: 0.5 }}>
            <BarberMascot isStatic color="var(--ink)" />
          </div>

          {navItems.map(n => {
            const isActive = n.key === activeNav;
            return (
              <button
                key={n.key}
                onClick={n.onClick ?? (() => setActiveNav(n.key))}
                style={{
                  border: 'none',
                  cursor: 'pointer',
                  background: isActive ? 'rgba(232,97,77,0.1)' : 'transparent',
                  color: isActive ? 'var(--coral)' : 'rgba(42,32,26,0.4)',
                  padding: '10px 0',
                  borderRadius: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 5,
                  width: 66,
                  fontSize: 9.5,
                  fontFamily: 'var(--font-dmsans)',
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  outline: isActive ? '1.5px solid rgba(232,97,77,0.28)' : '1.5px solid transparent',
                  transition: 'background 160ms ease, color 160ms ease, outline-color 160ms ease',
                }}
                onMouseEnter={e => {
                  if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(42,32,26,0.05)';
                }}
                onMouseLeave={e => {
                  if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
              >
                {n.icon}
                <span>{n.key}</span>
              </button>
            );
          })}
        </aside>

        {/* ── MAIN CONTENT ── */}
        <main className="min-w-0 overflow-y-auto cozy-scroll" style={{ padding: '24px 40px 80px', position: 'relative' }}>

          {/* Top bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div className={logoVisible ? 'slide-in-left' : 'opacity-0'}>
              <InlineWordmark />
            </div>
            <div style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
              <DashStat icon="🔥" top="Weekly Streak" bottom="5 days" />
              <div style={{ width: 1, height: 34, background: 'rgba(42,32,26,0.1)' }} />
              <DashStat icon="✂" top="Cuts Previewed" bottom={`${projects?.length ?? 0} total`} />
            </div>
            <div className={`flex items-center gap-3 ${rightVisible ? 'slide-in-right' : 'opacity-0'}`}>
              <ProfileMenu onRescan={onRescan} pulse={profilePillPulse} />
            </div>
          </div>

          {/* Title row */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32, marginTop: 28 }}>
            <div>
              <h1
                className="type-chonk"
                style={{ margin: 0, fontSize: 'clamp(4.5rem, 7vw, 6.5rem)', color: 'var(--ink)', lineHeight: 0.88 }}
              >
                My Cuts
              </h1>
              <p
                className="font-serif italic"
                style={{ fontSize: 17, color: 'rgba(42,32,26,0.5)', marginTop: 8, fontStyle: 'italic' }}
              >
                your styling studio. the cuts you{' '}
                <span style={{ borderBottom: '2px solid rgba(42,32,26,0.28)', paddingBottom: 1 }}>didn&rsquo;t</span> ruin.
              </p>
            </div>
            <div style={{ flex: 1 }} />
            {/* Search */}
            <div style={{ position: 'relative', width: 248 }}>
              <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'rgba(42,32,26,0.3)', fontSize: 14, pointerEvents: 'none' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L22 22" />
                </svg>
              </span>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="find a style..."
                style={{
                  width: '100%',
                  padding: '10px 14px 10px 38px',
                  border: '1px solid rgba(42,32,26,0.12)',
                  borderRadius: 9999,
                  background: 'rgba(42,32,26,0.05)',
                  fontSize: 14,
                  color: 'var(--ink)',
                  fontFamily: 'var(--font-fraunces), Georgia, serif',
                  fontStyle: 'italic',
                  outline: 'none',
                }}
                onFocus={e => (e.target.style.borderColor = 'rgba(232,97,77,0.5)')}
                onBlur={e => (e.target.style.borderColor = 'rgba(42,32,26,0.12)')}
              />
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 10, marginTop: 28, alignItems: 'center', flexWrap: 'wrap' }}>
            {['all', 'drafts', 'approved', 'experiments', 'this month'].map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                style={{
                  padding: '7px 17px',
                  border: `1.5px solid ${activeTab === t ? 'rgba(232,97,77,0.55)' : 'rgba(42,32,26,0.12)'}`,
                  background: activeTab === t ? 'rgba(232,97,77,0.08)' : 'transparent',
                  borderRadius: 9999,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-dmsans)',
                  fontWeight: 700,
                  fontSize: 13,
                  color: activeTab === t ? 'var(--coral)' : 'rgba(42,32,26,0.45)',
                  letterSpacing: '0.02em',
                  transition: 'all 160ms ease',
                }}
              >
                {t}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <span className="font-serif italic" style={{ fontSize: 17, color: 'rgba(42,32,26,0.35)', paddingRight: 6 }}>
              start here!
            </span>
            <svg width="32" height="38" viewBox="0 0 40 46" fill="none" stroke="rgba(42,32,26,0.25)" strokeWidth="1.6" strokeLinecap="round">
              <path d="M30 4 Q 4 12, 14 38" />
              <path d="M9 32 L14 38 L20 33" />
            </svg>
          </div>

          {/* Project grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 28, marginTop: 24 }}>
            {projects?.map((p, i) => (
              <ProjectCard
                key={p._id}
                project={p}
                onClick={() => onOpenProject(p)}
                rotate={[-1.4, 0.8, -0.6, 1.2, -0.8][i % 5]}
              />
            ))}
            <AddProjectButton onClick={onAdd} isEmpty={projects !== undefined && projects.length === 0} />
          </div>

          {/* Scan CTA when empty */}
          {showScanNow && !(projects && projects.length > 0) && (
            <div className="mt-8 flex justify-center">
              <BouncyButton onClick={onScanNow} className="btn" style={{ padding: '12px 28px', fontSize: 14, background: 'var(--coral)', color: 'var(--offwhite)', boxShadow: '0 4px 20px -4px rgba(232,97,77,0.4)' }}>
                ✂ Scan now
              </BouncyButton>
            </div>
          )}
        </main>

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
  const { openSignIn } = useClerk();
  const getOrCreate = useMutation(api.users.getOrCreate);
  const createProject = useMutation(api.projects.create);
  const saveProject = useMutation(api.projects.save);
  const meUser    = useQuery(api.users.getMe);
  const myProjects = useQuery(api.projects.list) as ProjectDoc[] | undefined;

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
      '/previewbutton.png',
      '/scanbutton.png',
      '/describebutton.png',
      '/showbarberbutton.png',
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
  const [appState, setAppState] = useState<AppState>('loading');
  const [activeProjectId, setActiveProjectId] = useState<Id<'projects'> | null>(null);

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
  const [showScanNowPopup, setShowScanNowPopup] = useState(false);
  const [showScanResult, setShowScanResult]     = useState(false);
  const [hasScanEver, setHasScanEver]           = useState(false);
  const [selfieFlying, setSelfieFlying] = useState<{ url: string; fromRect: DOMRect; toRect: DOMRect } | null>(null);
  const [profilePillPulse, setProfilePillPulse] = useState(false);

  // Auto-open scan popup (in username phase) on first login before username is set
  useEffect(() => {
    if (appState === 'home' && needsUsername) {
      setShowScanPopup(true);
    }
  }, [appState, needsUsername]);

  // Show "Scan now!" popup each time user enters home — skip if username setup is pending
  useEffect(() => {
    if (appState === 'home' && !hasScanEver && isSignedIn && !needsUsername) {
      const t = setTimeout(() => setShowScanNowPopup(true), 600);
      return () => clearTimeout(t);
    }
  }, [appState, hasScanEver, isSignedIn, needsUsername]);

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
    const profileWithMeasurements = ensureMeasurementSnapshot(p);
    setProfile(profileWithMeasurements);
    setParams(profileWithMeasurements.currentStyle.params);
    setHasScanEver(true);
    setShowScanPopup(false);

    if (splatUrl) setPersistedSplatUrl(splatUrl);

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
    if (!isSignedIn) { openSignIn(); return; }
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
          profilePillPulse={profilePillPulse}
        />

        {/* Scan now popup — on first entry */}
        {showScanNowPopup && (
          <ScanNowPopup
            onLetsDo={() => { setShowScanNowPopup(false); setShowScanPopup(true); }}
            onDismiss={() => setShowScanNowPopup(false)}
          />
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
    const faceliftReady = splatSrc != null;
    return (
      <main className="flex h-screen relative overflow-hidden bg-tomato-shop">
        <div className="absolute top-5 left-6 z-20">
          <InlineWordmark cream small />
        </div>

        <div className="flex-1 min-w-0 relative">
          {faceliftReady ? (
            <HairScene
              params={params}
              colorRGB={profile?.currentStyle.colorRGB ?? '#3b1f0a'}
              profile={profile ?? mockUserHeadProfile}
              splatSrcOverride={splatSrc}
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
    <main className="flex h-screen relative overflow-hidden bg-tomato-shop">
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
            splatSrcOverride={editSplatSrc ?? splatSrc ?? undefined}
            disableDefaultHairLayers={!!(editSplatSrc ?? splatSrc)}
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
