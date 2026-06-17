'use client';

// ============================================================
// BarberVideoCard — the "Show your barber!" 360° panel card.
//
// In the `ready` state the entire card (pill, re-film, the looping clip, and
// the save button) can pop out of its panel slot and smoothly lerp to a large,
// centered overlay — literally the same UI, just scaled up uniformly. On first
// success it auto-opens; a toggle button switches between the fullscreen /
// exit-fullscreen icons, and collapsing lerps it right back into its slot.
//
// Geometry: the card is enlarged with a transform-origin:0 0 scale, so a single
// captured slot rect drives both the position lerp and the uniform zoom. A slot
// <div> stays in flow as a spacer (and as the unscaled measuring target — a
// ResizeObserver keeps its height in sync as the async clip lays out).
// ============================================================

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import BarberVideoResult from '@/components/BarberVideoResult';

interface BarberVideoCardProps {
  onRequestVideo?: () => void;
  videoState?: 'idle' | 'recording' | 'encoding' | 'ready' | 'error';
  videoProgress?: number;
  videoUrl?: string | null;
  videoExt?: 'mp4' | 'webm';
  projectName?: string;
}

interface Rect { top: number; left: number; width: number; height: number; }

// Smooth lerp easing for the pop-out / collapse glide.
const GLIDE = 'top 560ms cubic-bezier(0.22,1,0.3,1), left 560ms cubic-bezier(0.22,1,0.3,1), transform 560ms cubic-bezier(0.22,1,0.3,1)';

// Four arrows pointing outward — "go fullscreen / expand".
function ExpandIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 3H3v5" />
      <path d="M21 8V3h-5" />
      <path d="M16 21h5v-5" />
      <path d="M3 16v5h5" />
    </svg>
  );
}

// Four arrows pointing inward — "exit fullscreen / shrink".
function CollapseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8h5V3" />
      <path d="M16 3v5h5" />
      <path d="M21 16h-5v5" />
      <path d="M8 21v-5H3" />
    </svg>
  );
}

// Scale that grows the collapsed card to a comfortably-larger centered size
// (~50% of viewport width), clamped so it never overflows the screen.
function computeScale(c: Rect): number {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxW = Math.min(vw * 0.5, 680);
  const maxH = vh * 0.84;
  let s = maxW / c.width;
  if (c.height * s > maxH) s = maxH / c.height;
  return Math.max(1, s);
}

const CARD_CLASS = 'flex-shrink-0 rounded-2xl px-5 py-4 flex flex-col gap-3';
const CARD_STYLE: React.CSSProperties = {
  background: 'var(--biscuit-lt)',
  border: '1px solid rgba(42,32,26,0.1)',
  boxShadow: '0 30px 60px -24px rgba(0,0,0,0.45)',
};

export default function BarberVideoCard({
  onRequestVideo,
  videoState = 'idle',
  videoProgress = 0,
  videoUrl,
  videoExt = 'mp4',
  projectName,
}: BarberVideoCardProps) {
  const slotRef = useRef<HTMLDivElement>(null);  // always in flow (card host / spacer)
  const floatRef = useRef<HTMLDivElement>(null); // the fixed, scaled card
  const [popped, setPopped] = useState(false);    // out of flow (fixed)
  const [centered, setCentered] = useState(false); // at center+scaled vs. slot
  const [rect, setRect] = useState<Rect | null>(null); // collapsed slot rect (unscaled)
  const [, setTick] = useState(0); // re-render on resize to recompute center
  const autoOpened = useRef(false);
  const isReady = videoState === 'ready';

  // Read the unscaled slot rect (the in-flow wrapper is never transformed).
  const measure = useCallback((): Rect | null => {
    const el = slotRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const next = { top: r.top, left: r.left, width: r.width, height: r.height };
    setRect(next);
    return next;
  }, []);

  const expand = useCallback(() => {
    if (!measure()) return;
    setPopped(true);
    setCentered(false);
    requestAnimationFrame(() => setCentered(true));
  }, [measure]);

  const collapse = useCallback(() => {
    measure(); // refresh slot position in case the panel scrolled
    setCentered(false);
  }, [measure]);

  // First time the clip is ready, pop it out to center automatically.
  useLayoutEffect(() => {
    if (!isReady || autoOpened.current) return;
    autoOpened.current = true;
    expand();
  }, [isReady, expand]);

  // If we leave the ready state (e.g. a re-film starts), drop back to the slot.
  useEffect(() => {
    if (!isReady) {
      autoOpened.current = false;
      if (popped) { setPopped(false); setCentered(false); }
    }
  }, [isReady, popped]);

  // Keep the slot height + centered geometry correct as the async clip lays out
  // and across viewport resizes. offsetHeight is the untransformed layout size,
  // so the scale never feeds back into the measurement.
  useEffect(() => {
    if (!popped) return;
    const el = floatRef.current;
    const sync = () => setRect((prev) => (prev && el ? { ...prev, height: el.offsetHeight, width: el.offsetWidth } : prev));
    const ro = el ? new ResizeObserver(sync) : null;
    if (el && ro) ro.observe(el);
    const onResize = () => { measure(); setTick((t) => t + 1); };
    window.addEventListener('resize', onResize);
    return () => { ro?.disconnect(); window.removeEventListener('resize', onResize); };
  }, [popped, measure]);

  // Lock body scroll while the overlay is open.
  useEffect(() => {
    if (!centered) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [centered]);

  const scale = popped && rect ? computeScale(rect) : 1;

  // While floating, position the card with fixed top/left + a transform-origin
  // top-left scale, so it lerps from the slot to a uniformly-larger center.
  let floatStyle: React.CSSProperties = {};
  if (popped && rect) {
    const base: React.CSSProperties = {
      position: 'fixed',
      width: rect.width,
      zIndex: 70,
      transformOrigin: '0 0',
      transition: GLIDE,
      willChange: 'top, left, transform',
    };
    if (centered) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      floatStyle = {
        ...base,
        top: Math.max(16, (vh - rect.height * scale) / 2),
        left: (vw - rect.width * scale) / 2,
        transform: `scale(${scale})`,
        boxShadow: '0 40px 90px -30px rgba(0,0,0,0.7)',
      };
    } else {
      floatStyle = { ...base, top: rect.top, left: rect.left, transform: 'scale(1)' };
    }
  }

  // The card UI — hosted in the slot at rest, and lifted into a body-level
  // portal while floating so its position:fixed geometry resolves against the
  // viewport instead of the Studio panel's transformed / scroll-clipped
  // ancestors, which otherwise swallow the expanded "fullscreen" card entirely.
  const card = (
        <div
          ref={floatRef}
          className={CARD_CLASS}
          style={{ ...CARD_STYLE, ...floatStyle }}
          onTransitionEnd={(e) => {
        // Once the collapse glide lands, return the card to normal flow so it
        // scrolls with the panel again.
        if (e.target === e.currentTarget && e.propertyName === 'top' && !centered) setPopped(false);
      }}
    >
      <div className="flex items-center justify-between">
        <span className="pill pill-tomato">NEW: Show your barber!</span>
        {isReady && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onRequestVideo?.()}
              aria-label="Record a fresh 360° video of the latest cut"
              className="font-mono text-[10px] uppercase tracking-wider text-[var(--smoke)] hover:text-[var(--ink)] transition-colors inline-flex items-center gap-1"
            >
              {/* refresh icon, sized 40% larger than the 10px label text */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 4v5h-5" />
              </svg>
              re-film
            </button>
            <button
              type="button"
              onClick={() => (centered ? collapse() : expand())}
              aria-label={centered ? 'Shrink the video back to the panel' : 'Expand the video'}
              title={centered ? 'Exit fullscreen' : 'Expand'}
              className="inline-flex items-center justify-center rounded-lg transition-transform hover:scale-110 active:scale-95"
              style={{
                width: 28, height: 28,
                color: 'var(--ink)',
                background: 'rgba(42,32,26,0.14)',
                border: '1px solid rgba(42,32,26,0.18)',
              }}
            >
              {centered ? <CollapseIcon /> : <ExpandIcon />}
            </button>
          </div>
        )}
      </div>

      {videoState === 'idle' && (
        <button
          onClick={() => onRequestVideo?.()}
          aria-label="Record a 360° video of your cut to show your barber"
          className="btn-cta-order"
        >
          <span className="btn-cta-order-beta" aria-label="beta">beta</span>
          <span className="btn-cta-order-title">
            <svg className="btn-cta-order-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="9.25" />
              <path d="M10 8.5v7l6-3.5z" fill="currentColor" stroke="none" />
            </svg>
            Get my 360°
          </span>
          <span className="btn-cta-order-sheen" aria-hidden />
        </button>
      )}

      {(videoState === 'recording' || videoState === 'encoding') && (
        <div className="receipt-stub" role="status" aria-label="Recording barber video">
          <div className="receipt-stub-slot" />
          <div className="receipt-stub-paper">
            <div className="receipt-stub-line w-3/4" />
            <div className="receipt-stub-line w-1/2" />
            <div className="receipt-stub-line w-2/3" />
          </div>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--smoke)] receipt-stub-label">
            {videoState === 'encoding' ? 'finishing up…' : `filming your 360… ${Math.round(videoProgress * 100)}%`}
          </span>
        </div>
      )}

      {videoState === 'error' && (
        <div className="error-shake px-3 py-2 rounded-lg bg-[rgba(217,78,58,0.08)] border border-[rgba(217,78,58,0.3)] text-[var(--cherry)] text-xs font-serif italic">
          <span className="font-sans text-[9px] uppercase tracking-wider mr-2 font-semibold not-italic">oops</span>
          couldn’t record the video — <button onClick={() => onRequestVideo?.()} className="underline">try again</button>
        </div>
      )}

          {isReady && videoUrl && (
            <BarberVideoResult videoUrl={videoUrl} ext={videoExt} projectName={projectName} />
          )}
        </div>
  );

  return (
    <>
      {/* Always-in-flow slot: hosts the card at rest, becomes a fixed-height
          spacer (and the unscaled measuring target) while the card floats in a
          body-level portal. */}
      <div
        ref={slotRef}
        className="flex-shrink-0 mt-3"
        style={popped && rect ? { height: rect.height } : undefined}
      >
        {!popped && card}
      </div>

      {popped && typeof document !== 'undefined' && createPortal(
        <>
          {centered && (
            <div
              onClick={collapse}
              aria-hidden
              style={{
                position: 'fixed', inset: 0, zIndex: 60,
                background: 'rgba(20,14,10,0.62)', backdropFilter: 'blur(3px)',
                animation: 'fadeIn 240ms ease',
              }}
            />
          )}
          {card}
        </>,
        document.body,
      )}
    </>
  );
}
