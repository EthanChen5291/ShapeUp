'use client';

import { HairMeasurementBBox, HairParams, UserHeadProfile } from '@/types';
import { buildHairMeasurementSnapshot, ensureMeasurementSnapshot } from '@/lib/hairMeasurementSnapshot';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useClerk, useUser } from '@clerk/nextjs';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { Id } from '@convex/_generated/dataModel';

import EditPanel from '@/components/EditPanel';
import { WaitlistPage } from '@/components/WaitlistPage';
import Image from 'next/image';
import { buildCurrentProfilePayload } from '@/lib/llmPayload';
import { useDemoFacelift } from '@/hooks/useDemoFacelift';
import dynamic from 'next/dynamic';
import { mockUserHeadProfile } from '@/data/mockProfile';
import { useSmirk } from '@/hooks/useSmirk';

const HairScene  = dynamic(() => import('@/components/HairScene'),  { ssr: false });
const ScanCamera = dynamic(() => import('@/components/ScanCamera'), { ssr: false });
const HairRecommendationsBar = dynamic(() => import('@/components/HairRecommendationsBar'), { ssr: false });

type AppState = 'loading' | 'home' | 'scan' | 'hairEditLoop' | '3d';
type RawHairBBox = Omit<HairMeasurementBBox, 'width' | 'height' | 'depth'>;

/* ─────────────── Barber Mascot SVG ─────────────── */
function BarberMascot({ snap = false, size = 'full', isStatic = false }: { snap?: boolean; size?: 'full' | 'sm'; isStatic?: boolean }) {
  const bladeClass = isStatic ? '' : snap ? 'scissor-snap-left' : 'scissor-blade-left';
  const bladeClassR = isStatic ? '' : snap ? 'scissor-snap-right' : 'scissor-blade-right';
  return (
    <svg
      viewBox="0 0 200 360"
      xmlns="http://www.w3.org/2000/svg"
      className={`${size === 'sm' ? 'w-full h-auto' : 'w-full h-auto'} drop-shadow-lg scissor-mascot`}
    >
      <line x1="94" y1="188" x2="58" y2="266" stroke="#2a201a" strokeWidth="13" strokeLinecap="round" />
      <line x1="106" y1="188" x2="142" y2="266" stroke="#2a201a" strokeWidth="13" strokeLinecap="round" />
      <circle cx="52" cy="300" r="34" fill="none" stroke="#2a201a" strokeWidth="14" />
      <circle cx="148" cy="300" r="34" fill="none" stroke="#2a201a" strokeWidth="14" />
      <g className={bladeClass}>
        <path d="M 108 172 L 88 188 L 32 28 L 48 22 Z" fill="#2a201a" stroke="#2a201a" strokeWidth="4" strokeLinejoin="round" />
      </g>
      <g className={bladeClassR}>
        <path d="M 92 172 L 112 188 L 168 28 L 152 22 Z" fill="#2a201a" stroke="#2a201a" strokeWidth="4" strokeLinejoin="round" />
      </g>
      <circle cx="100" cy="180" r="13" fill="#2a201a" />
    </svg>
  );
}

/* ─────────────── Inline wordmark (✂ Shape Up) ─────────────── */
function InlineWordmark({ cream = false, small = false }: { cream?: boolean; small?: boolean }) {
  const color = cream ? 'text-[var(--cream)]' : 'text-[var(--ink)]';
  const textSize = small ? 'text-[13px]' : 'text-[18px]';
  return (
    <div className={`wordmark-inline ${color} ${textSize}`}>
      <span style={{ width: small ? 20 : 28, display: 'inline-block' }}>
        <BarberMascot />
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

function LoadingScreen({ onDone }: { onDone: () => void }) {
  const [done, setDone] = useState(false);
  const [displayedProgress, setDisplayedProgress] = useState(0);
  const displayedRef = useRef(0);
  const isDoneRef = useRef(false);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

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

  useEffect(() => {
    const t = setTimeout(() => {
      isDoneRef.current = true;
      setDone(true);
      setTimeout(onDone, 650);
    }, LOAD_DURATION);
    return () => clearTimeout(t);
  }, [onDone]);

  const path = getRoundedRectPath(LD_M, LD_M, LD_W, LD_H, LD_R);

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
          <path d={path} fill="none" stroke="rgba(214,60,47,0.1)" strokeWidth="3" />
          <path
            d={path}
            fill="none"
            stroke="var(--tomato)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={LD_PERIM}
            strokeDashoffset={LD_PERIM * (1 - displayedProgress)}
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
function ProfileMenu() {
  const { user: clerkUser, isSignedIn } = useUser();
  const { openSignIn, signOut } = useClerk();
  const userQuery = useQuery(api.users.getMe);
  const [open, setOpen] = useState(false);
  const [bouncing, setBouncing] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const stableUserRef = useRef(userQuery);
  if (userQuery != null) stableUserRef.current = userQuery;
  const user = stableUserRef.current;

  if (!isSignedIn) {
    return (
      <BouncyButton onClick={() => openSignIn()} className="btn-ink" style={{ padding: '9px 18px', fontSize: 11 }}>
        Sign in
      </BouncyButton>
    );
  }

  const username = clerkUser?.username ?? clerkUser?.firstName ?? clerkUser?.emailAddresses?.[0]?.emailAddress?.split('@')[0] ?? 'You';

  const handleToggle = () => {
    setOpen(o => !o);
  };

  return (
    <div
      className={`relative z-50 ${bouncing ? 'profile-pill-bounce' : ''}`}
      style={{
        background: 'var(--cream)',
        border: '1px solid rgba(42,32,26,0.12)',
        backdropFilter: 'blur(8px)',
        borderRadius: open ? 18 : 40,
        width: open ? 290 : 176,
        overflow: 'hidden',
        transition: open
          ? 'width 540ms cubic-bezier(.08,.82,.17,1), border-radius 420ms cubic-bezier(.08,.82,.17,1), background 280ms ease, box-shadow 300ms ease'
          : 'width 320ms cubic-bezier(.4,0,1,1), border-radius 300ms cubic-bezier(.4,0,1,1), background 280ms ease, box-shadow 300ms ease',
        boxShadow: open ? '0 20px 50px -12px rgba(0,0,0,0.3)' : 'none',
      }}
    >
      {/* Pill header */}
      <button
        onClick={handleToggle}
        className="flex items-center gap-2 w-full px-3 py-2"
        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
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

      {/* Expanding content */}
      <div style={{
        maxHeight: open ? '400px' : '0px',
        overflow: 'hidden',
        opacity: open ? 1 : 0,
        transition: open
          ? 'max-height 540ms cubic-bezier(.08,.82,.17,1), opacity 300ms 130ms ease'
          : 'max-height 320ms cubic-bezier(.4,0,1,1), opacity 180ms ease',
      }}>
        <div className="px-4 pb-4 flex flex-col gap-3" style={{ borderTop: '1px solid rgba(42,32,26,0.08)', paddingTop: 12 }}>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[12px] uppercase tracking-wider text-[var(--smoke)]">Tokens</span>
              <span className="font-sans text-[17px] text-[var(--ink)]" style={{ fontWeight: 700 }}>
                {user?.credits ?? 0}
              </span>
            </div>
            <BouncyButton
              onClick={() => setShowPricing(true)}
              className="btn btn-tomato w-full relative overflow-hidden"
              style={{ padding: '9px 16px', fontSize: 12, letterSpacing: '0.06em', fontWeight: 700, boxShadow: 'none' }}
            >
              <span className="shine-sweep" />
              <span style={{ position: 'relative' }}>Get more!</span>
            </BouncyButton>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="font-mono text-[12px] uppercase tracking-wider text-[var(--smoke)]">Friends</span>
              <span className="font-sans text-[17px] text-[var(--ink)]" style={{ fontWeight: 700 }}>0</span>
            </div>
          </div>

          <div className="border-t border-dashed border-[var(--char)]/15 pt-2 flex flex-col gap-0.5">
            <BouncyButton
              onClick={() => {}}
              className="w-full text-left font-sans text-[13px] uppercase tracking-wider text-[var(--smoke)] hover:text-[var(--ink)] transition-colors py-1"
              style={{ background: 'none', border: 'none' }}
            >
              ⚙ Settings
            </BouncyButton>
            <BouncyButton
              onClick={() => { setOpen(false); signOut(); }}
              className="w-full text-left font-sans text-[13px] uppercase tracking-wider text-[var(--smoke)] hover:text-[var(--tomato)] transition-colors py-1"
              style={{ background: 'none', border: 'none' }}
            >
              Sign out
            </BouncyButton>
          </div>
        </div>
      </div>

      {showPricing && <PricingPopup onDismiss={() => setShowPricing(false)} />}
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
const SCAN_STEPS = [
  { label: 'Face scan',       delay: 0,    duration: 2600 },
  { label: 'Mirror scan',     delay: 700,  duration: 2800 },
  { label: 'AI styling',      delay: 1400, duration: 2400 },
  { label: '3D preview',      delay: 2100, duration: 2600 },
  { label: "Barber's notes",  delay: 2800, duration: 2200 },
  { label: 'Second opinions', delay: 3500, duration: 2400 },
];

function OrganicBar({ label, startDelay = 0, duration = 2400 }: { label: string; startDelay?: number; duration?: number }) {
  const [visible, setVisible] = useState(startDelay === 0);
  useEffect(() => {
    if (startDelay === 0) return;
    const t = setTimeout(() => setVisible(true), startDelay);
    return () => clearTimeout(t);
  }, [startDelay]);
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
        {visible && <div className="organic-bar-anim" style={{ animationDuration: `${duration}ms` }} />}
      </div>
    </div>
  );
}

type ScanPhase = 'camera' | 'verify' | 'processing';

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

/* ─────────────── Scan Popup (camera in popup form) ─────────────── */
function ScanPopup({
  onScanComplete,
  onDismiss,
}: {
  onScanComplete: (p: UserHeadProfile, sid: string | null, url: string | null) => void;
  onDismiss: () => void;
}) {
  const [phase, setPhase] = useState<ScanPhase>('camera');
  const [cameraKey, setCameraKey] = useState(0);
  const [captured, setCaptured] = useState<{ profile: UserHeadProfile; sid: string | null; url: string | null } | null>(null);
  const [showVerifyBtns, setShowVerifyBtns] = useState(false);
  const [collapsing, setCollapsing] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [paywallDisabled, setPaywallDisabled] = useState(false);
  const isDismissing = useRef(false);

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(d => setPaywallDisabled(d.paywallDisabled ?? false));
  }, []);

  // Entry animation — two sequential phases: slide in edge-on, then rotate to face
  const [slideIn, setSlideIn] = useState(false);
  const [rotateIn, setRotateIn] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showRequirements, setShowRequirements] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setSlideIn(true), 30);       // slide edge-on into view: 480ms
    const t2 = setTimeout(() => setRotateIn(true), 530);     // rotate to face user: 550ms
    const t3 = setTimeout(() => setExpanded(true), 1150);    // expand width
    const t4 = setTimeout(() => setShowRequirements(true), 1950);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, []);

  const dismiss = () => {
    if (isDismissing.current) return;
    isDismissing.current = true;
    setCollapsing(true);
    setTimeout(() => setExiting(true), 750);
    setTimeout(onDismiss, 1400);
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

  const handleProceed = () => {
    setShowVerifyBtns(false);
    setPhase('processing');
    const lastStep = SCAN_STEPS[SCAN_STEPS.length - 1];
    const totalMs = lastStep.delay + lastStep.duration + 800;
    setTimeout(() => {
      if (captured && !isDismissing.current) {
        isDismissing.current = true;
        setExiting(true);
        setTimeout(() => onScanComplete(captured.profile, captured.sid, captured.url), 600);
      }
    }, totalMs);
  };

  const panelTransition = exiting
    ? 'transform 550ms cubic-bezier(.2,.85,.2,1)'
    : (collapsing || expanded)
    ? 'width 750ms cubic-bezier(.2,.85,.2,1)'
    : rotateIn
    ? 'transform 550ms cubic-bezier(.2,.85,.2,1)'
    : slideIn
    ? 'transform 480ms cubic-bezier(.2,.85,.2,1)'
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
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'rgba(255,248,234,0.5)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.12em',
                  marginBottom: 28,
                }}>
                  <LetterFade text="Before you shoot" startDelay={0} charDelay={30} />
                </p>
                {SELFIE_REQS.map((req, i) => (
                  <div key={req.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 24 }}>
                    <span style={{ fontSize: 16, color: 'var(--tomato)', flexShrink: 0, marginTop: 2 }}>{req.icon}</span>
                    <p style={{ fontFamily: 'var(--font-dmsans)', fontSize: 16, color: 'var(--cream)', fontWeight: 500, lineHeight: 1.4, margin: 0 }}>
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
                  Analyzing your look...
                </p>
                {SCAN_STEPS.map(s => (
                  <OrganicBar key={s.label} label={s.label} startDelay={s.delay} duration={s.duration} />
                ))}
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
                Take a selfie!
              </h2>
              <button
                onClick={dismiss}
                className="absolute right-7 w-9 h-9 flex items-center justify-center rounded-full transition-all"
                style={{ color: 'rgba(255,248,234,0.5)', background: 'rgba(255,248,234,0.07)' }}
              >
                ✕
              </button>
            </div>

            {/* Camera body */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 28px', position: 'relative', minHeight: 0 }}>
              {phase === 'camera' && (
                <div
                  key={cameraKey}
                  style={{ width: '100%', maxWidth: 460, position: 'relative' }}
                >
                  <ScanCamera
                    hairType="straight"
                    onScanComplete={handleCapture}
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
}: { project: ProjectDoc; onClick: () => void }) {
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
        background: 'rgba(255,248,234,0.12)',
        border: '1px solid rgba(255,248,234,0.2)',
        aspectRatio: '3/4',
        backdropFilter: 'blur(4px)',
      }}
    >
      {project.thumbnailUrl ? (
        <img src={project.thumbnailUrl} alt={project.name} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.2)' }}>
          <div style={{ width: 40, opacity: 0.4, transform: 'rotate(186deg)' }}>
            <BarberMascot isStatic />
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
function AddProjectButton({ onClick }: { onClick: () => void }) {
  return (
    <BouncyButton
      onClick={onClick}
      className="relative rounded-2xl flex items-center justify-center transition-opacity hover:opacity-90"
      style={{
        background: 'rgba(42,32,26,0.35)',
        border: 'none',
        aspectRatio: '3/4',
        backdropFilter: 'blur(4px)',
      }}
    >
      <span
        className="text-[var(--cream)] font-sans font-bold"
        style={{ fontSize: 32, opacity: 0.7, lineHeight: 1 }}
      >
        +
      </span>
    </BouncyButton>
  );
}

/* ─────────────── Social types ─────────────── */
interface FriendData {
  userId: Id<'users'>;
  username: string;
  cutCount: number;
  unreadCount: number;
}
interface FriendRequestData {
  friendshipId: Id<'friends'>;
  userId: Id<'users'>;
  username: string;
}

/* ─────────────── Avatar helpers ─────────────── */
function avatarBgColor(username: string): string {
  const palette = ['#c0402e', '#b5541e', '#7a5430', '#3d6b50', '#2e5e7a', '#6a3d7a'];
  const h = username.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return palette[h % palette.length];
}

function AvatarCircle({ username, size = 40 }: { username: string; size?: number }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%',
        background: avatarBgColor(username),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, color: 'rgba(255,248,234,0.92)',
        fontFamily: 'var(--font-dmsans)', fontWeight: 700,
        fontSize: Math.round(size * 0.38), userSelect: 'none',
      }}
    >
      {username.slice(0, 2).toUpperCase()}
    </div>
  );
}

/* ─────────────── Friend Row ─────────────── */
function FriendRow({
  friend,
  onOpenProfile,
  onOpenConversation,
}: {
  friend: FriendData;
  onOpenProfile: () => void;
  onOpenConversation: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ transition: 'background 150ms ease' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,248,234,0.06)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <button
        onClick={e => { e.stopPropagation(); onOpenProfile(); }}
        className="flex-shrink-0 hover:scale-110 active:scale-95 transition-transform"
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
      >
        <AvatarCircle username={friend.username} size={40} />
      </button>
      <button
        onClick={onOpenConversation}
        className="flex-1 min-w-0 text-left"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-sans text-[var(--cream)] text-sm font-semibold truncate">
            {friend.username}
          </span>
          {friend.unreadCount > 0 && (
            <span className="font-mono text-[var(--tomato)] text-[9px] font-bold uppercase tracking-wider flex-shrink-0">
              new msg
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="font-mono text-[10px]" style={{ color: 'rgba(255,248,234,0.35)' }}>
            ✂ {friend.cutCount} cuts
          </span>
          {friend.unreadCount > 0 && (
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--tomato)' }} />
          )}
        </div>
      </button>
    </div>
  );
}

/* ─────────────── Search Panel ─────────────── */
function SearchPanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const results = useQuery(api.friends.searchUsers, query.length >= 2 ? { query } : 'skip') as
    | { userId: Id<'users'>; username: string }[]
    | undefined;
  const sendRequest = useMutation(api.friends.sendRequest);
  const [requested, setRequested] = useState<Set<string>>(new Set());

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,248,234,0.08)' }}>
        <button onClick={onClose} className="font-sans text-[var(--cream)]/50 hover:text-[var(--cream)] transition-colors text-lg leading-none" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>←</button>
        <span className="font-display italic text-[var(--cream)]" style={{ fontSize: 18, fontWeight: 600 }}>Add Friends</span>
      </div>
      <div className="px-4 py-3 flex-shrink-0">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by username..."
          autoFocus
          className="w-full rounded-full px-4 py-2 font-sans text-sm outline-none"
          style={{ background: 'rgba(255,248,234,0.08)', border: '1px solid rgba(255,248,234,0.1)', color: 'var(--cream)' }}
        />
      </div>
      <div className="flex-1 overflow-y-auto cozy-scroll px-4">
        {results?.map(u => (
          <div key={u.userId} className="flex items-center gap-3 py-2.5">
            <AvatarCircle username={u.username} size={38} />
            <span className="flex-1 font-sans text-[var(--cream)] text-sm font-semibold truncate">{u.username}</span>
            <button
              onClick={async () => {
                await sendRequest({ addresseeId: u.userId });
                setRequested(s => new Set([...s, u.userId]));
              }}
              disabled={requested.has(u.userId)}
              className="font-sans text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-full flex-shrink-0"
              style={{
                background: requested.has(u.userId) ? 'rgba(255,248,234,0.1)' : 'var(--tomato)',
                color: 'var(--cream)', border: 'none',
                cursor: requested.has(u.userId) ? 'default' : 'pointer',
              }}
            >
              {requested.has(u.userId) ? 'Sent ✓' : 'Add'}
            </button>
          </div>
        ))}
        {query.length >= 2 && results?.length === 0 && (
          <p className="font-sans text-sm text-center py-8" style={{ color: 'rgba(255,248,234,0.35)' }}>No users found</p>
        )}
        {query.length < 2 && (
          <p className="font-sans text-xs text-center py-8" style={{ color: 'rgba(255,248,234,0.25)' }}>Type a username to search</p>
        )}
      </div>
    </div>
  );
}

/* ─────────────── Message Thread ─────────────── */
function MessageThread({
  friendId,
  friendUsername,
  meId,
  onClose,
}: {
  friendId: Id<'users'>;
  friendUsername: string;
  meId: Id<'users'>;
  onClose: () => void;
}) {
  const messages = useQuery(api.messages.listConversation, { friendId });
  const sendMsg = useMutation(api.messages.send);
  const markRead = useMutation(api.messages.markRead);
  const [text, setText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    markRead({ senderId: friendId }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    await sendMsg({ receiverId: friendId, text: t });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,248,234,0.08)' }}>
        <button onClick={onClose} className="font-sans text-[var(--cream)]/50 hover:text-[var(--cream)] transition-colors text-lg leading-none" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>←</button>
        <AvatarCircle username={friendUsername} size={30} />
        <span className="flex-1 font-sans text-[var(--cream)] font-semibold text-sm">{friendUsername}</span>
      </div>
      <div className="flex-1 overflow-y-auto cozy-scroll px-4 py-3 flex flex-col gap-2 min-h-0">
        {messages?.length === 0 && (
          <p className="font-sans text-xs text-center py-6" style={{ color: 'rgba(255,248,234,0.3)' }}>Start the conversation ✂</p>
        )}
        {messages?.map((msg: { _id: string; senderId: Id<'users'>; text: string }) => {
          const isMine = msg.senderId === meId;
          return (
            <div key={msg._id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div
                className="max-w-[82%] px-3 py-2 font-sans text-sm leading-snug"
                style={{
                  background: isMine ? 'var(--tomato)' : 'rgba(255,248,234,0.1)',
                  color: 'var(--cream)',
                  borderRadius: isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                }}
              >
                {msg.text}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div className="px-4 py-3 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,248,234,0.08)' }}>
        <div className="flex items-center gap-2">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
            placeholder="Message..."
            className="flex-1 rounded-full px-4 py-2 font-sans text-sm outline-none"
            style={{ background: 'rgba(255,248,234,0.08)', border: '1px solid rgba(255,248,234,0.1)', color: 'var(--cream)' }}
          />
          <button
            onClick={() => void handleSend()}
            className="rounded-full flex items-center justify-center flex-shrink-0 hover:scale-105 active:scale-95 transition-transform"
            style={{ width: 34, height: 34, background: 'var(--tomato)', border: 'none', cursor: 'pointer', color: 'var(--cream)', fontSize: 16 }}
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Friends Panel ─────────────── */
function FriendsPanel({ openSearch, onSearchClose }: { openSearch: boolean; onSearchClose: () => void }) {
  const friends = useQuery(api.friends.list) as FriendData[] | undefined;
  const requests = useQuery(api.friends.listRequests) as FriendRequestData[] | undefined;
  const acceptRequest = useMutation(api.friends.acceptRequest);
  const meUser = useQuery(api.users.getMe);

  const [view, setView] = useState<'list' | 'search' | 'conversation'>('list');
  const [activeThread, setActiveThread] = useState<FriendData | null>(null);
  const [profileFriend, setProfileFriend] = useState<FriendData | null>(null);

  useEffect(() => {
    if (openSearch) setView('search');
  }, [openSearch]);

  const handleCloseSearch = () => {
    setView('list');
    onSearchClose();
  };

  if (view === 'search') return <SearchPanel onClose={handleCloseSearch} />;

  if (view === 'conversation' && activeThread && meUser?._id) {
    return (
      <MessageThread
        friendId={activeThread.userId}
        friendUsername={activeThread.username}
        meId={meUser._id}
        onClose={() => { setActiveThread(null); setView('list'); }}
      />
    );
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 pt-4 pb-3 flex-shrink-0">
        <h2 className="font-display italic text-[var(--cream)]" style={{ fontSize: 19, fontWeight: 600 }}>Friends</h2>
        <button
          onClick={() => setView('search')}
          className="flex items-center justify-center rounded-full hover:scale-110 active:scale-95 transition-transform"
          style={{ width: 30, height: 30, background: 'rgba(255,248,234,0.08)', border: 'none', cursor: 'pointer', color: 'rgba(255,248,234,0.6)' }}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.5"/>
            <line x1="8.7" y1="8.7" x2="11.5" y2="11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {requests && requests.length > 0 && (
        <div className="px-4 mb-2 flex-shrink-0">
          <p className="font-mono text-[9px] uppercase tracking-wider mb-1.5" style={{ color: 'rgba(255,248,234,0.35)' }}>Requests</p>
          {requests.map(req => (
            <div key={req.friendshipId} className="flex items-center gap-3 py-2">
              <AvatarCircle username={req.username} size={34} />
              <span className="flex-1 font-sans text-[var(--cream)] text-sm font-semibold truncate">{req.username}</span>
              <button
                onClick={() => acceptRequest({ friendshipId: req.friendshipId })}
                className="font-sans text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full flex-shrink-0"
                style={{ background: 'var(--tomato)', color: 'var(--cream)', border: 'none', cursor: 'pointer' }}
              >
                Accept
              </button>
            </div>
          ))}
          <div style={{ height: 1, background: 'rgba(255,248,234,0.08)', margin: '6px 0 10px' }} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto cozy-scroll px-1 min-h-0">
        {friends != null && friends.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-4 py-12" style={{ opacity: 0.38 }}>
            <div style={{ width: 32, transform: 'rotate(186deg)' }}><BarberMascot isStatic /></div>
            <p className="font-sans text-[var(--cream)] text-xs text-center leading-snug">No friends yet.<br/>Add some to see their cuts!</p>
          </div>
        )}
        {friends?.map(f => (
          <FriendRow
            key={f.userId}
            friend={f}
            onOpenProfile={() => setProfileFriend(f)}
            onOpenConversation={() => { setActiveThread(f); setView('conversation'); }}
          />
        ))}
      </div>

      {profileFriend && (
        <FriendProfileModal
          friend={profileFriend}
          onClose={() => setProfileFriend(null)}
          onOpenConversation={() => {
            const f = profileFriend;
            setProfileFriend(null);
            setActiveThread(f);
            setView('conversation');
          }}
        />
      )}
    </>
  );
}

/* ─────────────── Friend Profile Modal (two-stage animation) ─────────────── */
type ProfileModalStage = 'init' | 'circle' | 'rect' | 'unpacking' | 'full' | 'closing';

function FriendProfileModal({
  friend,
  onClose,
  onOpenConversation,
}: {
  friend: FriendData;
  onClose: () => void;
  onOpenConversation?: () => void;
}) {
  const [stage, setStage] = useState<ProfileModalStage>('init');
  const projects = useQuery(api.friends.getFriendProjects, { userId: friend.userId }) as ProjectDoc[] | undefined;
  const isDismissing = useRef(false);

  useEffect(() => {
    const t1 = setTimeout(() => setStage('circle'), 30);
    const t2 = setTimeout(() => setStage('rect'), 330);
    const t3 = setTimeout(() => setStage('unpacking'), 1380);
    const t4 = setTimeout(() => setStage('full'), 2040);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, []);

  const close = () => {
    if (isDismissing.current) return;
    isDismissing.current = true;
    setStage('closing');
    setTimeout(onClose, 350);
  };

  const isCircle = stage === 'init' || stage === 'circle';
  const isRect = stage === 'rect';
  const isUnpacking = stage === 'unpacking' || stage === 'full';
  const isFull = stage === 'full';
  const isClosing = stage === 'closing';

  const cardLeft = isUnpacking ? '5vw' : isRect ? 'calc(50% - 140px)' : 'calc(50% - 32px)';
  const cardTop  = isUnpacking ? '5vh'  : isRect ? 'calc(50% - 190px)' : 'calc(50% - 32px)';
  const cardW    = isUnpacking ? '36vw' : isRect ? '280px' : '64px';
  const cardH    = isUnpacking ? '90vh' : isRect ? '380px' : '64px';
  const cardR    = isUnpacking ? 26 : isRect ? 22 : 9999;
  const cardBg   = isCircle ? avatarBgColor(friend.username) : '#201a13';

  return (
    <div
      className="fixed inset-0 z-50"
      style={{
        background: isClosing ? 'rgba(0,0,0,0)' : isUnpacking ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0.45)',
        transition: 'background 400ms ease',
      }}
      onClick={close}
    >
      {/* Profile card */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: cardLeft,
          top: cardTop,
          width: cardW,
          height: cardH,
          borderRadius: cardR,
          background: cardBg,
          boxShadow: '0 40px 100px -24px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,248,234,0.08)',
          overflow: 'hidden',
          opacity: stage === 'init' || isClosing ? 0 : 1,
          transition: [
            'left 650ms cubic-bezier(.2,.85,.2,1)',
            'top 650ms cubic-bezier(.2,.85,.2,1)',
            'width 450ms cubic-bezier(.2,.85,.2,1)',
            'height 450ms cubic-bezier(.2,.85,.2,1)',
            'border-radius 450ms cubic-bezier(.2,.85,.2,1)',
            'background 300ms ease',
            'opacity 300ms ease',
          ].join(', '),
        }}
      >
        {/* Initials — visible only in circle stage */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ opacity: isCircle ? 1 : 0, transition: 'opacity 180ms ease', pointerEvents: 'none' }}
        >
          <span style={{ fontFamily: 'var(--font-dmsans)', fontWeight: 700, fontSize: 22, color: 'rgba(255,248,234,0.92)' }}>
            {friend.username.slice(0, 2).toUpperCase()}
          </span>
        </div>

        {/* Profile content — fades in after rect expansion */}
        <div
          className="absolute inset-0 flex flex-col items-center gap-5 p-7"
          style={{
            opacity: isCircle ? 0 : 1,
            transition: 'opacity 280ms ease 200ms',
            justifyContent: isUnpacking ? 'flex-start' : 'center',
            paddingTop: isUnpacking ? 48 : 28,
          }}
        >
          {!isCircle && (isRect || isUnpacking) && (
            <button
              onClick={close}
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full transition-all"
              style={{ background: 'rgba(255,248,234,0.1)', color: 'rgba(255,248,234,0.6)', border: 'none', cursor: 'pointer', fontSize: 13 }}
            >✕</button>
          )}
          <AvatarCircle username={friend.username} size={isUnpacking ? 76 : 60} />
          <div className="text-center">
            <h3 className="font-display italic text-[var(--cream)]" style={{ fontSize: isUnpacking ? 24 : 20, fontWeight: 600 }}>{friend.username}</h3>
            <p className="font-mono mt-1" style={{ fontSize: 12, color: 'rgba(255,248,234,0.45)' }}>✂ {friend.cutCount} cuts</p>
          </div>
          <button
            className="btn btn-tomato"
            style={{ padding: '9px 22px', fontSize: 13 }}
            onClick={() => { onOpenConversation?.(); }}
          >
            💬 Message
          </button>
        </div>
      </div>

      {/* Projects panel — slides in from right */}
      {isUnpacking && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: 'calc(5vw + 36vw + 16px)',
            top: '5vh',
            right: '5vw',
            height: '90vh',
            borderRadius: 26,
            background: '#201a13',
            boxShadow: '0 40px 100px -24px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,248,234,0.08)',
            overflow: 'hidden',
            opacity: isFull ? 1 : 0,
            transform: isFull ? 'translateX(0)' : 'translateX(36px)',
            transition: 'opacity 420ms ease 200ms, transform 520ms cubic-bezier(.2,.85,.2,1) 150ms',
          }}
        >
          <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid rgba(255,248,234,0.07)' }}>
            <h2 className="font-display italic text-[var(--cream)]" style={{ fontSize: 20, fontWeight: 600 }}>
              {friend.username}&rsquo;s cuts
            </h2>
          </div>
          <div className="overflow-y-auto cozy-scroll p-5" style={{ height: 'calc(100% - 60px)' }}>
            {projects?.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ opacity: 0.35 }}>
                <div style={{ width: 32, transform: 'rotate(186deg)' }}><BarberMascot isStatic /></div>
                <p className="font-sans text-[var(--cream)] text-xs">No cuts yet</p>
              </div>
            )}
            <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {projects?.map(p => (
                <ProjectCard key={p._id} project={p} onClick={() => {}} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────── Main Menu ─────────────── */
function MainMenu({
  onAdd,
  onOpenProject,
  showScanNow,
  onScanNow,
}: {
  onAdd: () => void;
  onOpenProject: (project: ProjectDoc) => void;
  showScanNow: boolean;
  onScanNow: () => void;
}) {
  const projects = useQuery(api.projects.list) as ProjectDoc[] | undefined;
  const [menuVisible, setMenuVisible] = useState(false);
  const [logoVisible, setLogoVisible] = useState(false);
  const [friendSearchOpen, setFriendSearchOpen] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setMenuVisible(true), 60);
    const t2 = setTimeout(() => setLogoVisible(true), 190);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <main className="relative min-h-screen bg-tomato-shop overflow-hidden">
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-start justify-between px-6 py-4">
        <div className={logoVisible ? 'slide-in-left' : 'opacity-0'}>
          <InlineWordmark cream />
        </div>
        <div className="flex flex-col items-end gap-2">
          <ProfileMenu />
          <BouncyButton
            onClick={() => setFriendSearchOpen(true)}
            className="btn btn-tomato"
            style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em' }}
          >
            + Add Friend
          </BouncyButton>
        </div>
      </div>

      {/* Content — two-column layout */}
      <div className={`relative z-10 flex h-screen pt-16 ${menuVisible ? 'slide-in-left' : 'opacity-0'}`}>

        {/* LEFT — Projects (flex-[3] ≈ 58% of space) */}
        <div className="min-w-0 overflow-y-auto cozy-scroll px-10 py-6" style={{ flex: 3 }}>
          <p className="font-serif italic text-[var(--cream)] text-sm mb-6" style={{ opacity: 0.75 }}>
            A neighborhood AI barber
          </p>
          <div
            className="grid"
            style={{ gridTemplateColumns: 'repeat(2, 1fr)', columnGap: 52, rowGap: 28 }}
          >
            <AddProjectButton onClick={onAdd} />
            {projects?.map(p => (
              <ProjectCard key={p._id} project={p} onClick={() => onOpenProject(p)} />
            ))}
          </div>
          {showScanNow && (
            <div className="mt-8 flex justify-center">
              <BouncyButton onClick={onScanNow} className="btn btn-cream" style={{ padding: '10px 22px', fontSize: 13 }}>
                ✂ Scan now
              </BouncyButton>
            </div>
          )}
        </div>

        {/* DIVIDER */}
        <div style={{ width: 1, background: 'rgba(255,248,234,0.1)', flexShrink: 0, margin: '16px 0' }} />

        {/* RIGHT — Friends panel (flex-[2] ≈ 42% of space) */}
        <div className="min-w-0 flex flex-col" style={{ flex: 2 }}>
          <FriendsPanel
            openSearch={friendSearchOpen}
            onSearchClose={() => setFriendSearchOpen(false)}
          />
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

/* ─────────────── Progress bar loader ─────────────── */
const LOAD_STEPS = [
  'Mirror scan',
  'AI styling',
  '3D preview',
  'Barber\'s notes',
  'Second opinions',
];

function OrganicProgressBar({ label, duration = 2200 }: { label: string; duration?: number }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    setWidth(0);
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setWidth(100));
    });
    return () => cancelAnimationFrame(raf);
  }, [label]);

  return (
    <div className="flex flex-col gap-1 w-full max-w-xs">
      <span className="font-sans text-[11px] uppercase tracking-wider text-[var(--cream)]" style={{ opacity: 0.8 }}>
        {label}
      </span>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,248,234,0.2)' }}>
        <div
          className="h-full rounded-full"
          style={{
            background: 'var(--butter)',
            width: `${width}%`,
            transition: `width ${duration}ms cubic-bezier(.4,0,.2,1)`,
          }}
        />
      </div>
    </div>
  );
}

function FaceliftLoader({ demoStatus }: { demoStatus: string }) {
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (demoStatus === 'done') return;
    const t = setInterval(() => {
      setStepIdx(i => Math.min(i + 1, LOAD_STEPS.length - 1));
    }, 2400);
    return () => clearInterval(t);
  }, [demoStatus]);

  return (
    <div className="flex flex-col items-center gap-4 p-8">
      <OrganicProgressBar key={LOAD_STEPS[stepIdx]} label={LOAD_STEPS[stepIdx]} duration={2200} />
      {demoStatus === 'error' && (
        <span className="font-mono text-[10px] text-[var(--butter)] opacity-85">Error — check console</span>
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
  const currentParams = profile.currentStyle.params;
  const llmPayload = buildCurrentProfilePayload(profile);
  const liveMeasurementsJson = JSON.stringify(llmPayload.measurementSnapshot, null, 2);
  const llmPayloadJson = JSON.stringify(llmPayload, null, 2);

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

      <div className="flex flex-col gap-4">
        <p className="text-xs text-gray-500 uppercase tracking-widest">Hair Parameters</p>
        {([ { key: 'pc1', label: 'Hair length' }, { key: 'pc2', label: 'Width' }, { key: 'pc3', label: 'Ponytail-ness' }, { key: 'pc4', label: 'Density' }, { key: 'pc5', label: 'Wavyness' }, { key: 'pc6', label: 'Parting' } ] as const).map(({ key, label }) => (
          <div key={key} className="flex flex-col gap-1">
            <div className="flex justify-between text-sm">
              <span>{label}</span>
              <span className="text-gray-400">{(currentParams[key] ?? 0).toFixed(2)}</span>
            </div>
            <input type="range" min={-3} max={3} step={0.1} value={currentParams[key] ?? 0} disabled onChange={() => {}} className="slider-warm w-full opacity-40 cursor-not-allowed" />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 pt-4 border-t border-dashed border-[var(--char)]/20">
        <div className="flex items-baseline justify-between">
          <span className="pill pill-denim">live measurements</span>
          <span className="font-mono text-[10px] text-[var(--smoke)]">auto</span>
        </div>
        <textarea readOnly value={liveMeasurementsJson} className="input-soft w-full rounded-xl p-3 font-mono text-[11px] leading-snug resize-none h-40 focus:outline-none" style={{ fontStyle: 'normal' }} />
      </div>

      <div className="flex flex-col gap-2 pt-4 border-t border-dashed border-[var(--char)]/20">
        <div className="flex items-baseline justify-between">
          <span className="pill pill-denim">llm payload</span>
          <span className="font-mono text-[10px] text-[var(--smoke)]">current_profile</span>
        </div>
        <textarea readOnly value={llmPayloadJson} className="input-soft w-full rounded-xl p-3 font-mono text-[11px] leading-snug resize-none h-56 focus:outline-none" style={{ fontStyle: 'normal' }} />
      </div>

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

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (isSignedIn) {
      getOrCreate().catch((err) => console.error('[Home] getOrCreate FAILED:', err));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

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

  // UI state
  const [showScanPopup, setShowScanPopup]       = useState(false);
  const [showScanNowPopup, setShowScanNowPopup] = useState(false);
  const [showScanResult, setShowScanResult]     = useState(false);
  const [hasScanEver, setHasScanEver]           = useState(false);

  // Show "Scan now!" popup each time user enters home
  useEffect(() => {
    if (appState === 'home' && !hasScanEver && isSignedIn) {
      const t = setTimeout(() => setShowScanNowPopup(true), 600);
      return () => clearTimeout(t);
    }
  }, [appState, hasScanEver, isSignedIn]);

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
  const { splatSrc, status: demoStatus, error: demoError } = useDemoFacelift(imageUrl);

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

  const handleScanComplete = (p: UserHeadProfile, sid: string | null, url: string | null) => {
    const profileWithMeasurements = ensureMeasurementSnapshot(p);
    setProfile(profileWithMeasurements);
    setParams(profileWithMeasurements.currentStyle.params);
    setHasScanEver(true);
    setShowScanPopup(false);
    if (url) {
      setSessionId(sid);
      setImageUrl(url);
      setShowScanResult(true); // show result popup first
    } else {
      setAppState('3d');
    }
  };

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
    const id = await createProject({ name: `Cut #${Date.now().toString(36).slice(-4).toUpperCase()}` });
    setActiveProjectId(id as Id<'projects'>);
    setShowScanPopup(true);
  };

  const handleOpenProject = (project: ProjectDoc) => {
    setActiveProjectId(project._id);
    if (project.lastProfile) setProfile(project.lastProfile as UserHeadProfile);
    if (project.lastHairParams) setParams(project.lastHairParams as HairParams);
    if (project.lastImageUrl) setImageUrl(project.lastImageUrl);
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
    return <LoadingScreen onDone={() => setAppState('home')} />;
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
          />
        )}

        {/* Scan result popup */}
        {showScanResult && imageUrl && (
          <ScanResultPopup
            imageUrl={imageUrl}
            onContinue={() => { setShowScanResult(false); setAppState('hairEditLoop'); }}
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
              <div className="polaroid wonky-sm-l" style={{ maxWidth: 340 }}>
                <div className="tape tape-tl" /><div className="tape tape-tr" />
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
          <div className="absolute top-24 left-6 z-10 polaroid wonky-l" style={{ width: 100, padding: '6px 6px 22px' }}>
            <img src={imageUrl} alt="scan" className="block w-full h-[82px] object-cover rounded-sm" />
            <div className="absolute bottom-1 inset-x-0 text-center font-display text-[var(--char)] text-sm" style={{ fontStyle: 'italic', fontWeight: 500 }}>you</div>
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
            flameData={smirk.result ? { vertices: smirk.result.vertices_canonical, faces: smirk.result.faces } : undefined}
          />

          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--cream)]/70 pointer-events-none">
            <span>live · 3d sculpt</span>
            <span>no. 03·42</span>
          </div>
        </div>
      </div>

      <aside className="w-80 flex-shrink-0 flex flex-col p-4 gap-4 relative overflow-hidden">
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
            onImageUpdated={(url) => setImageUrl(url)}
            onPlyReady={(url) => {
              if (url.startsWith('/')) { setEditSplatSrc(url); }
              else { setHairstepPlyUrl(`/api/proxy-ply?url=${encodeURIComponent(url)}`); }
            }}
            onUncertain={() => setShowRecommendations(true)}
          />
        </div>
      </aside>
    </main>
  );
}
