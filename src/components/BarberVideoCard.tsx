'use client';

// ============================================================
// BarberVideoCard — the "Show your barber!" 360° panel card.
//
// In the `ready` state the card (pill, re-film, the looping clip, and the save
// button) can pop out of its panel slot and smoothly grow to a large, centered
// overlay. On first success it auto-opens; the fullscreen toggle expands it, and
// the icon flips to exit-fullscreen to shrink it right back into its slot.
//
// Two things make this feel native:
//
//  1. Never-reload video. The card markup lives in a single persistent host node
//     that is *physically re-parented* (appendChild) between the slot and a
//     body-level overlay — React only ever portals into that one host, so the
//     <video> element is never unmounted and the loop never stutters.
//
//  2. Crisp growth via real layout — exactly like the Studio's expanding
//     polaroid. The overlay animates its `width` (and glides its centre from the
//     slot to the viewport centre); the card re-lays-out at the new width every
//     frame, so the clip and chrome stay razor sharp — no zoomed bitmap. The
//     overlay portals to <body> so its position:fixed escapes the Studio panel's
//     transformed / scroll-clipped ancestors, which would otherwise swallow it.
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

// Matches the polaroid's expand feel (width 0.4s, gentle overshoot).
const DUR = 420;
const EASE = 'cubic-bezier(0.34,1.2,0.64,1)';
// Enlarged size — bounded to the viewport so it can never run off-screen.
const BIG_WIDTH = 'min(560px, 92vw)';
const BIG_VIDEO_MAX_H = '64vh';

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

const CARD_CLASS = 'flex-shrink-0 rounded-2xl px-5 py-4 flex flex-col gap-3';
const REST_SHADOW = '0 30px 60px -24px rgba(0,0,0,0.45)';
const BIG_SHADOW = '0 40px 90px -30px rgba(0,0,0,0.7)';

export default function BarberVideoCard({
  onRequestVideo,
  videoState = 'idle',
  videoProgress = 0,
  videoUrl,
  videoExt = 'mp4',
  projectName,
}: BarberVideoCardProps) {
  const slotRef = useRef<HTMLDivElement>(null);     // in-flow at-rest mount / spacer
  const overlayRef = useRef<HTMLDivElement>(null);  // fixed positioner in the body portal
  // Persistent host the card markup is portaled into. It is re-parented between
  // the slot and the overlay so the <video> never unmounts. display:contents so
  // the host adds no box of its own — the card lays out as a direct child.
  const hostRef = useRef<HTMLDivElement | null>(null);
  if (typeof document !== 'undefined' && !hostRef.current) {
    hostRef.current = document.createElement('div');
    hostRef.current.style.display = 'contents';
  }

  const [popped, setPopped] = useState(false);     // out of flow (fixed overlay)
  const [centered, setCentered] = useState(false); // enlarged + centred vs. at slot
  const [rect, setRect] = useState<Rect | null>(null); // collapsed slot rect
  // True once the clip's intrinsic size is known. We hold the auto-open until
  // then so the slot is measured at the card's real (loaded) height — otherwise
  // the spacer freezes short and the toolbox only catches up after the preview
  // has already settled back into its corner.
  const [dimsReady, setDimsReady] = useState(false);
  const autoOpened = useRef(false);
  const isReady = videoState === 'ready';

  // Read the collapsed card rect from the slot (host lives there at rest; the
  // slot is a fixed-height spacer while floating — a clean measuring target).
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

  // Re-parent the persistent host into the slot (at rest) or the overlay (popped)
  // synchronously, before paint — moving the node keeps the <video> alive.
  useLayoutEffect(() => {
    const host = hostRef.current;
    const target = popped ? overlayRef.current : slotRef.current;
    if (host && target && host.parentNode !== target) target.appendChild(host);
  });

  // First time the clip is ready *and* measured, pop it out to center. Waiting
  // for dimsReady means the slot already holds the full-height card, so the
  // toolbox rides up while the preview animates — not after it lands.
  useLayoutEffect(() => {
    if (!isReady || !dimsReady || autoOpened.current) return;
    autoOpened.current = true;
    expand();
  }, [isReady, dimsReady, expand]);

  // If we leave the ready state (e.g. a re-film starts), drop back to the slot.
  useEffect(() => {
    if (!isReady) {
      autoOpened.current = false;
      setDimsReady(false);
      if (popped) { setPopped(false); setCentered(false); }
    }
  }, [isReady, popped]);

  // A fresh clip arrives — re-arm the dimension gate for the new video.
  useEffect(() => { setDimsReady(false); }, [videoUrl]);

  // Lock body scroll while the overlay is open.
  useEffect(() => {
    if (!centered) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [centered]);

  // The card markup. It fills whatever container it currently sits in (slot or
  // overlay), so growth comes entirely from the overlay's animated width.
  const cardMarkup = (
    <div
      className={CARD_CLASS}
      style={{
        background: 'var(--biscuit-lt)',
        border: '1px solid rgba(42,32,26,0.1)',
        boxShadow: centered ? BIG_SHADOW : REST_SHADOW,
        transition: `box-shadow ${DUR}ms ease`,
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
        <BarberVideoResult
          videoUrl={videoUrl}
          ext={videoExt}
          projectName={projectName}
          videoMaxHeight={centered ? BIG_VIDEO_MAX_H : undefined}
          onDimensions={() => setDimsReady(true)}
        />
      )}
    </div>
  );

  // Fixed overlay positioner. Centred via translate(-50%,-50%), so we only glide
  // its centre-point (slot centre → viewport centre) and animate its width.
  const overlayStyle: React.CSSProperties = popped && rect ? {
    position: 'fixed',
    zIndex: 70,
    transform: 'translate(-50%, -50%)',
    transition: `top ${DUR}ms ${EASE}, left ${DUR}ms ${EASE}, width ${DUR}ms ${EASE}`,
    willChange: 'top, left, width',
    ...(centered
      ? { top: '50%', left: '50%', width: BIG_WIDTH }
      : { top: rect.top + rect.height / 2, left: rect.left + rect.width / 2, width: rect.width }),
  } : {};

  return (
    <>
      {/* Always-in-flow slot: hosts the card at rest, becomes a fixed-height
          spacer (and measuring target) while the card floats in the portal. */}
      <div
        ref={slotRef}
        className="flex-shrink-0 mt-3"
        style={popped && rect ? { height: rect.height } : undefined}
      />

      {/* The card markup lives permanently in the persistent host. */}
      {hostRef.current && createPortal(cardMarkup, hostRef.current)}

      {/* Body-level overlay so position:fixed escapes the Studio panel's
          transformed / scroll-clipped ancestors. The host is re-parented into
          the positioner imperatively (see the layout effect above). */}
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
          <div
            ref={overlayRef}
            style={overlayStyle}
            onTransitionEnd={(e) => {
              // Once the shrink glide lands, drop back to normal flow so the card
              // scrolls with the panel again.
              if (e.target === e.currentTarget && e.propertyName === 'width' && !centered) setPopped(false);
            }}
          />
        </>,
        document.body,
      )}
    </>
  );
}
