'use client';

import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useUser } from '@clerk/nextjs';
import { useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import Image from 'next/image';
import Link from 'next/link';
import { BarberMascot, BouncyButton, Reveal } from '@/components/AppUI';
import SignUpWidget from '@/components/SignUpWidget';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useT } from '@/lib/i18n';
import { startCheckout } from '@/lib/checkout';

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
  const [displayIdx, setDisplayIdx] = useState(0);
  const activeRef    = useRef(0);
  const videoRefs    = useRef<(HTMLVideoElement | null)[]>([]);
  const wrapperRefs  = useRef<(HTMLDivElement | null)[]>([]);
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
    activeRef.current = newIdx;
    onActiveChangeRef.current?.(newIdx);

    if (!next) return;
    if (cur) next.currentTime = cur.currentTime;

    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      next.playbackRate = 1.3;
      next.play().catch(() => {});
      setDisplayIdx(newIdx);
      // Restart bounce animation imperatively so rapid swipes always retrigger
      const wrapper = wrapperRefs.current[newIdx];
      if (wrapper) {
        wrapper.style.animation = 'none';
        void wrapper.offsetHeight; // force reflow
        wrapper.style.animation = 'face-bounce 520ms cubic-bezier(0.34, 1.45, 0.64, 1) both';
      }
    };

    next.addEventListener('seeked', reveal, { once: true });
    setTimeout(reveal, 80); // fallback if seeked never fires
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
      {/* Visual layer: circular frame + border. Kept separate from the event container so wheel/touch hit area is unaffected. */}
      <div style={{
        position: 'absolute',
        left: '50%', top: '50%',
        transform: 'translate(-50%, -50%)',
        width: '68%',
        aspectRatio: '1 / 1',
        borderRadius: '50%',
        overflow: 'hidden',
        pointerEvents: 'none',
      } as React.CSSProperties}>
        {/* overfill wrapper — video covers the circle so no rectangular edge shows */}
        <div style={{ position: 'absolute', inset: 0, transform: 'scale(1.2)', transformOrigin: 'center center' }}>
          {FACE_VIDS.map((src, i) => (
            // Per-face transform + opacity wrapper
            <div
              key={src}
              style={{
                position: 'absolute', inset: 0,
                opacity: i === displayIdx ? 1 : 0,
                transition: 'opacity 80ms ease',
                transform: i === 0 ? 'scale(0.99)' : i === 1 ? 'scale(0.87) translateY(4%)' : i === 2 ? 'scale(0.88) translateY(4%)' : i === 3 ? 'scale(0.97)' : i === 4 ? 'scale(0.96)' : undefined,
              }}
            >
              {/* Bounce animation wrapper — animated imperatively via wrapperRefs */}
              <div
                ref={el => { wrapperRefs.current[i] = el; }}
                style={{ position: 'absolute', inset: 0 }}
              >
                <video
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
                    clipPath: (i === 1 || i === 2 || i === 3) ? 'inset(1.5% 0 2% 0)' : 'inset(1.5% 0 1.5% 0)',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

/* ─────────────── Scroll Arrows ─────────────── */
function ScrollArrows({ swipeTriggerRef, onClickUp, onClickDown, isMobile }: { swipeTriggerRef: React.MutableRefObject<((dir: 'up' | 'down') => void) | null>; onClickUp?: () => void; onClickDown?: () => void; isMobile?: boolean }) {
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

  const SH = isMobile ? 54 : 78;
  const SW = isMobile ? 96 : 140;
  // left: 30 + 200% of SW (170) = 370; tops derived from centered pair ± vertical shifts
  const arrowLeft = 218.5;

  // On mobile the sprite container shrinks (max 360px wide), so the arrows are
  // sized down and centered horizontally, anchored close to the sprite edges.
  const upPos: React.CSSProperties = isMobile
    ? { left: `calc(50% - ${SW / 2}px)`, top: '3%' }
    : { left: arrowLeft, top: 'calc(50% - 314.4px)' };
  const downPos: React.CSSProperties = isMobile
    ? { left: `calc(50% - ${SW / 2}px)`, bottom: '2%' }
    : { left: arrowLeft, top: 'calc(50% + 258px)' };

  return (
    <>
      <div
        ref={upContainerRef}
        onMouseEnter={() => setUpHovered(true)}
        onMouseLeave={() => setUpHovered(false)}
        onClick={onClickUp}
        style={{ position: 'absolute', ...upPos, width: SW, height: SH, willChange: 'transform', zIndex: 20, cursor: 'pointer' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={upHovered ? "/arrows/arrowup_highlighted.png" : "/arrows/arrowup.png"} alt="scroll up" style={{ width: SW, height: SH, display: 'block', position: 'relative' as const, zIndex: 1, opacity: upHovered ? 1 : 0.5, transition: 'opacity 0.15s ease' }} />
      </div>
      <div
        ref={downContainerRef}
        onMouseEnter={() => setDownHovered(true)}
        onMouseLeave={() => setDownHovered(false)}
        onClick={onClickDown}
        style={{ position: 'absolute', ...downPos, width: SW, height: SH, willChange: 'transform', zIndex: 20, cursor: 'pointer' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={downHovered ? "/arrows/arrowdown_highlighted.png" : "/arrows/arrowdown.png"} alt="scroll down" style={{ width: SW, height: SH, display: 'block', position: 'relative' as const, zIndex: 1, opacity: downHovered ? 1 : 0.5, transition: 'opacity 0.15s ease' }} />
      </div>
    </>
  );
}

/* ─────────────── Face2 Video Swiper + Show Barber Demo ─────────────── */
/* Idle video shown before the first message is sent (no message sent yet). */
const FACE2_IDLE_VID = '/landing_face2/face2.mp4';

const FACE2_VIDS = ['/landing_face2/face2a.mp4', '/landing_face2/face2b.mp4', '/landing_face2/face2c.mp4', '/landing_face2/face2d.mp4', '/landing_face2/face2e.mp4', '/landing_face2/face2f.mp4', '/landing_face2/face2g.mp4', '/landing_face2/face2h.mp4'];

const FACE2_MESSAGES = [
  "Take 6 inches off",        // face2a — bob
  "Wavy dirty blonde",        // face2b — wavy blonde
  "Go full blonde",           // face2c — blonde
  "Messy high bun",           // face2d — messy high bun
  "Twin buns, tied up",       // face2e — tied twin buns
  "Wolf cut + red streaks",   // face2f — red streaks + wolf cut
  "Go full pink",             // face2g — pink hair
  "Two pigtails, please",     // face2h — two pigtails
];

/* Barber replies — one per request, same index. Short, confident, points to step 3. */
const FACE2_REPLIES = [
  "✂ Snip snip — check step 3 →", // face2a — bob
  "Color's mixed. Look right →",  // face2b — wavy blonde
  "Full blonde. Bold. →",         // face2c — blonde
  "Pinned it up for you →",       // face2d — messy high bun
  "Twin buns, pinned →",          // face2e — tied twin buns
  "Wolf cut + streaks in →",      // face2f — red streaks + wolf cut
  "Full pink. Bold. →",           // face2g — pink hair
  "Pigtails, rendered →",         // face2h — two pigtails
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
  // Idle video plays until the first message is sent, then fades to the message videos.
  const [started, setStarted] = useState(false);
  const startedRef = useRef(false);
  const idleVideoRef = useRef<HTMLVideoElement | null>(null);
  const activeRef = useRef(0);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const bounceDivRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const wheelLock = useRef(false);
  const onActiveChangeRef = useRef(onActiveChange);
  useEffect(() => { onActiveChangeRef.current = onActiveChange; }, [onActiveChange]);

  const switchTo = useCallback((newIdx: number) => {
    const cur = videoRefs.current[activeRef.current];
    const next = videoRefs.current[newIdx];
    if (cur) cur.pause();
    if (next) {
      if (cur) {
        const t = cur.currentTime;
        // Only sync timestamp if target video has buffered that position;
        // otherwise setting currentTime silently snaps to 0.
        let canSync = false;
        for (let i = 0; i < next.buffered.length; i++) {
          if (next.buffered.start(i) <= t && t <= next.buffered.end(i)) { canSync = true; break; }
        }
        if (canSync) next.currentTime = t;
      }
      next.play().catch(() => {});
    }
    activeRef.current = newIdx;
    setActiveIdx(newIdx);
    onActiveChangeRef.current?.(newIdx);

    const el = bounceDivRef.current;
    if (el) {
      el.style.animation = 'none';
      void el.offsetHeight; // force reflow to restart animation
      el.style.animation = 'face2-bounce 500ms cubic-bezier(0.34, 1.56, 0.64, 1) both';
    }
  }, []);

  const goNext = useCallback(() => switchTo((activeRef.current + 1) % FACE2_VIDS.length), [switchTo]);
  const goPrev = useCallback(() => switchTo((activeRef.current - 1 + FACE2_VIDS.length) % FACE2_VIDS.length), [switchTo]);

  useEffect(() => {
    if (scrollRef) scrollRef.current = { goNext, goPrev };
  }, [scrollRef, goNext, goPrev]);

  useEffect(() => {
    if (externalIdx === undefined) return;
    const firstStart = !startedRef.current;
    if (firstStart) {
      startedRef.current = true;
      setStarted(true);
      idleVideoRef.current?.pause();
    }
    // On the very first send (index 0) the active index already matches, so
    // force the switch to play the message video and fade the idle one out.
    if (firstStart || externalIdx !== activeRef.current) {
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

  // Speed curve is baked into the video — just play at 1×. The idle video shows
  // first (before any message is sent); message videos take over after.
  useEffect(() => {
    idleVideoRef.current?.play().catch(() => {});
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
        <div ref={bounceDivRef} style={{ position: 'absolute', inset: 0, transform: 'scale(0.85)', transformOrigin: 'center center' }}>
          {/* Idle video — plays before the first message is sent */}
          <video
            key={FACE2_IDLE_VID}
            ref={idleVideoRef}
            src={FACE2_IDLE_VID}
            muted playsInline loop preload="auto"
            style={{
              position: 'absolute', top: 0, left: 0,
              width: '100%', height: '100%',
              objectFit: 'cover',
              opacity: started ? 0 : 1,
              transition: 'opacity 60ms ease',
            }}
          />
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
                opacity: started && i === activeIdx ? 1 : 0,
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

type DescribeChatMsg = { id: number; text: string; isNew: boolean; from?: 'user' | 'barber'; disintegrating?: boolean; disintegrateDelay?: number };

function DescribeMsgBubble({ msg }: { msg: DescribeChatMsg }) {
  const isBarber = msg.from === 'barber';
  const [showText, setShowText] = useState(!msg.isNew);

  useEffect(() => {
    if (!msg.isNew) {
      // Message was superseded — resolve any pending loading state immediately
      setShowText(true);
      return;
    }
    // The barber "thinks" a beat longer than the user types
    const t = setTimeout(() => setShowText(true), isBarber ? 720 : 300);
    return () => clearTimeout(t);
  }, [msg.isNew, isBarber]);

  const bg = isBarber ? PHONE_INK : PHONE_CREAM;
  const fg = isBarber ? PHONE_CREAM : PHONE_INK;

  return (
    <div
      style={{
        position: 'relative',
        alignSelf: isBarber ? 'flex-start' : 'flex-end',
        maxWidth: '86%',
        background: bg,
        color: fg,
        borderRadius: showText
          ? (isBarber ? '18px 18px 18px 4px' : '18px 18px 4px 18px')
          : '18px',
        padding: showText ? '8px 12px' : '8px 13px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif',
        fontSize: 14, fontWeight: 400, lineHeight: 1.35, letterSpacing: '-0.01em',
        boxShadow: isBarber ? '0 2px 10px rgba(40,12,6,0.32)' : '0 2px 10px rgba(80,20,10,0.14)',
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
              background: fg, opacity: 0.45,
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
        <svg
          style={{
            position: 'absolute', bottom: 0, display: 'block',
            ...(isBarber ? { left: -8, transform: 'scaleX(-1)' } : { right: -8 }),
          }}
          width="12" height="11" viewBox="0 0 12 11"
        >
          <path d="M 0 0 Q 4 0 7 3 Q 10 6 12 11 Q 5 9 2 5 Q 0 3 0 0 Z" fill={bg} />
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

  const scrollRef = useRef({ y: 0, yTarget: 0 });

  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPending = useCallback(() => {
    pendingTimers.current.forEach(clearTimeout);
    pendingTimers.current = [];
  }, []);

  // rAF lerp: smoothly scrolls msgListRef to follow new messages at the bottom
  useEffect(() => {
    const s = scrollRef.current;
    let rafId: number;
    const loop = () => {
      s.y += (s.yTarget - s.y) * 0.075;
      if (msgListRef.current) {
        msgListRef.current.style.transform = `translateY(${s.y.toFixed(2)}px)`;
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // On first message of each cycle: snap to near-bottom so it enters from below
  useEffect(() => {
    if (msgs.length !== 1 || lerpActiveRef.current) return;
    lerpActiveRef.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!chatAreaRef.current || !msgListRef.current) return;
        const outerH = chatAreaRef.current.clientHeight;
        const innerH = msgListRef.current.offsetHeight;
        const offset = Math.max(0, outerH - 16 - innerH - 6);
        scrollRef.current.y = offset;
        scrollRef.current.yTarget = 0;
      });
    });
  }, [msgs]);

  // Keep scroll target updated so newest messages stay visible at the bottom
  useEffect(() => {
    requestAnimationFrame(() => {
      if (!chatAreaRef.current || !msgListRef.current) return;
      const outerH = chatAreaRef.current.clientHeight;
      const innerH = msgListRef.current.offsetHeight;
      const overflow = innerH + 16 - outerH;
      scrollRef.current.yTarget = overflow > 0 ? -overflow : scrollRef.current.yTarget;
    });
  }, [msgs]);

  const triggerInactivityReset = useCallback(() => {
    clearPending();
    setMsgs(prev => prev.map((m, i) => ({ ...m, isNew: false, disintegrating: true, disintegrateDelay: i * 60 })));
    scrollRef.current.yTarget = 0;
    const t = setTimeout(() => {
      lerpActiveRef.current = false;
      idRef.current = 0;
      curIdxRef.current = 0;
      setCurIdx(0);
      setMsgs([]);
    }, 600);
    pendingTimers.current.push(t);
  }, [clearPending]);

  const handleSend = useCallback(() => {
    setSendBouncing(false);
    requestAnimationFrame(() => setSendBouncing(true));
    setTimeout(() => setSendBouncing(false), 500);

    // Reset inactivity timer — fade+reset fires 15s after the last send
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = setTimeout(() => triggerInactivityReset(), 15000);

    const idx = curIdxRef.current;
    const text = FACE2_MESSAGES[idx];
    const next = (idx + 1) % FACE2_MESSAGES.length;
    curIdxRef.current = next;
    setCurIdx(next);
    onSendRef.current?.(idx);

    const newMsg: DescribeChatMsg = { id: idRef.current++, text, isNew: true };
    setMsgs(prev => [newMsg, ...prev.map(m => ({ ...m, isNew: false }))]);

    // The barber replies a beat later — every sent message gets its own reply
    const t = setTimeout(() => {
      setMsgs(prev => [
        { id: idRef.current++, text: FACE2_REPLIES[idx], isNew: true, from: 'barber' as const },
        ...prev.map(m => ({ ...m, isNew: false })),
      ]);
    }, 600);
    pendingTimers.current.push(t);
  }, [clearPending, triggerInactivityReset]);

  // Clear all pending timers if the demo unmounts mid-conversation
  useEffect(() => () => {
    clearPending();
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
  }, [clearPending]);

  const [sendBouncing, setSendBouncing] = useState(false);
  const [sendHovered, setSendHovered] = useState(false);
  const nextMsg = FACE2_MESSAGES[curIdx];

  return (
    <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
      <div style={{
        width: '88%',
        aspectRatio: '966 / 1326',
        borderRadius: 18,
        background: PHONE_TOMATO,
        overflow: 'hidden',
        position: 'relative',
        boxShadow: '0 16px 48px -10px rgba(217,78,58,0.45)',
      }}>
        {/* Chat header — who you're texting */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 38,
          background: 'rgba(0,0,0,0.22)',
          display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px',
          zIndex: 1,
        }}>
          <div style={{ width: 22, height: 22, borderRadius: '50%', background: PHONE_CREAM, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
            <div style={{ width: 24 }}>
              <BarberMascot isStatic color={PHONE_TOMATO} />
            </div>
          </div>
          <span style={{ fontFamily: 'var(--font-dmsans), sans-serif', fontSize: 11.5, fontWeight: 700, color: PHONE_CREAM, letterSpacing: '0.02em' }}>
            ShapeUp
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#52ca78', boxShadow: '0 0 0 2px rgba(82,202,120,0.28)', flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--font-dmsans), sans-serif', fontSize: 9, fontWeight: 600, color: 'rgba(255,248,234,0.75)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              online
            </span>
          </span>
        </div>
        {/* Chat scroll area */}
        <div
          ref={chatAreaRef}
          style={{
            position: 'absolute', top: 38, left: 0, right: 0, bottom: 76,
            overflow: 'hidden',
          }}
        >
          <div
            ref={msgListRef}
            style={{
              position: 'absolute', top: 16, left: 0, right: 0,
              display: 'flex', flexDirection: 'column', gap: 7,
              padding: '0 12px',
            }}
          >
            {[...msgs].reverse().map(m => <DescribeMsgBubble key={m.id} msg={m} />)}
          </div>
        </div>
        {/* Typing bar */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 76,
          background: 'rgba(0,0,0,0.22)',
          display: 'flex', alignItems: 'center', padding: '0 14px', gap: 10,
        }}>
          <div style={{
            flex: 1, background: PHONE_CREAM, borderRadius: 24,
            padding: '9px 16px',
            fontSize: 13.5, color: PHONE_INK,
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            lineHeight: 1.35,
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          }}>
            {nextMsg}<span className="type-caret" />
          </div>
          <button
            onClick={handleSend}
            onMouseEnter={() => setSendHovered(true)}
            onMouseLeave={() => setSendHovered(false)}
            className={sendBouncing ? 'send-btn-bounce' : sendHovered ? undefined : 'send-btn-pulse'}
            style={{
              width: 44, height: 44, borderRadius: '50%',
              background: PHONE_CREAM, border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0,
              boxShadow: '0 4px 16px rgba(0,0,0,0.22)',
              position: 'relative',
              overflow: 'hidden',
              transform: sendBouncing ? undefined : sendHovered ? 'scale(1.28) rotate(-14deg)' : undefined,
              transition: sendBouncing ? undefined : 'transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          >
            {/* Tomato fill circle — grows from center on hover */}
            <div style={{
              position: 'absolute', inset: 0,
              borderRadius: '50%',
              background: PHONE_TOMATO,
              transform: sendHovered ? 'scale(1)' : 'scale(0)',
              transition: 'transform 380ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              transformOrigin: 'center',
              pointerEvents: 'none',
            }} />
            {/* CW tracing ring — starts at 12 o'clock, traces clockwise */}
            <svg
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                pointerEvents: 'none',
              }}
              viewBox="0 0 44 44"
            >
              <circle
                cx="22" cy="22" r="19.5"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 19.5}`}
                style={{
                  stroke: 'rgba(255,255,255,0.82)',
                  strokeWidth: '2.5',
                  strokeDashoffset: sendHovered ? 0 : 2 * Math.PI * 19.5,
                  transition: sendHovered
                    ? 'stroke-dashoffset 440ms cubic-bezier(0.4, 0, 0.2, 1) 20ms'
                    : 'stroke-dashoffset 320ms cubic-bezier(0.6, 0, 0.8, 0)',
                }}
              />
            </svg>
            {/* Arrow — white on hover */}
            <svg width="17" height="17" viewBox="0 0 12 12" fill="none" style={{ position: 'relative', zIndex: 1 }}>
              <path
                d="M6 10.5V1.5M6 1.5L2.5 5M6 1.5L9.5 5"
                stroke={sendHovered ? 'rgba(255,255,255,0.95)' : PHONE_TOMATO}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transition: 'stroke 180ms ease' }}
              />
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
      {/* Live request pill — names what's rendering, re-pops on every send */}
      <div style={{ position: 'absolute', bottom: '5%', left: '50%', transform: 'translateX(-50%)', zIndex: 3, pointerEvents: 'none' }}>
        <span
          key={activeIdx ?? -1}
          className="popup-in"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'var(--ink)', color: 'var(--cream)',
            borderRadius: 9999, padding: '7px 15px',
            boxShadow: '0 10px 26px -6px rgba(0,0,0,0.45)',
            whiteSpace: 'nowrap',
          }}
        >
          <span className="dot-open" style={{ width: 7, height: 7 }} />
          <span className="font-display" style={{ fontStyle: 'italic', fontWeight: 500, fontSize: 13, lineHeight: 1 }}>
            {activeIdx !== undefined ? `\u201C${FACE2_MESSAGES[activeIdx]}\u201D` : 'your current cut'}
          </span>
        </span>
      </div>
    </div>
  );
}

/* ─────────────── Glimpse / Orbit Section ─────────────── */
const GLIMPSE_SATELLITE_COUNT = 6;
const GLIMPSE_FINAL_RADIUS = 343;
const GLIMPSE_ERUPTION_DURATION = 1900;
const GLIMPSE_ORBIT_SPEED = 0.00022; // radians per ms, CCW
// Design size of the orbit stage (full diameter incl. satellite cards × tallest extent).
const GLIMPSE_STAGE_WIDTH = 868;
const GLIMPSE_STAGE_HEIGHT = 960;

function GlimpseSection() {
  const t = useT();
  const isMobile = useIsMobile();
  // The orbit stage is laid out at its 868px design width. On mobile that
  // overflows the viewport, so we shrink the whole stage with a transform.
  // NOTE: scale() needs a unitless number — a CSS calc() of lengths is invalid
  // and gets silently dropped, so the scale must be computed in JS.
  const [mobileScale, setMobileScale] = useState(0.34);
  useEffect(() => {
    if (!isMobile) return;
    const compute = () => {
      const fit = (window.innerWidth - 16) / GLIMPSE_STAGE_WIDTH;
      // Cap at ~1/3 so the orbit stays comfortably inside the screen with margin.
      setMobileScale(Math.min(0.34, fit));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [isMobile]);

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
      // Accumulate orbit continuously so there's no speed gap at the transition
      s.orbitOffset += GLIMPSE_ORBIT_SPEED * dt;
      // Total sweep = eruption arc + continuous orbit component
      const sweepOffset = ease * (Math.PI * 1.5) + s.orbitOffset;

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
        // Fold the eruption arc into orbitOffset so orbiting picks up at the same angle
        s.orbitOffset += Math.PI * 1.5;
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

    const startLoop = () => {
      cancelAnimationFrame(rafRef.current);
      stateRef.current.lastTime = 0;
      rafRef.current = requestAnimationFrame(runFrame);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (stateRef.current.phase === 'idle') {
            stateRef.current.phase = 'erupting';
            stateRef.current.eruptionStart = performance.now();
            setCenterVisible(true);
          }
          startLoop();
        } else {
          // Pause when scrolled out of view — saves GPU/battery
          cancelAnimationFrame(rafRef.current);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);

    // Restart if the RAF chain died while the tab was hidden (Safari, etc.)
    const handleVisibility = () => {
      if (!document.hidden && stateRef.current.phase !== 'idle') {
        startLoop();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
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
      <Reveal>
      <h2
        className="font-serif"
        style={{ fontSize: 'clamp(1.9rem, 3.6vw, 3rem)', color: 'var(--cream)', marginBottom: 50, lineHeight: 1.25, letterSpacing: '-0.01em' }}
      >
        {t('Get a glimpse of all')}{' '}
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
          &ldquo;{t('you')}&rdquo;
        </em>{' '}
        {t('could be.')}
      </h2>
      </Reveal>

      {/* Orbit stage */}
      <div
        ref={sectionRef}
        style={{ position: 'relative', height: GLIMPSE_STAGE_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', ...(isMobile ? { height: GLIMPSE_STAGE_HEIGHT * mobileScale, transform: `scale(${mobileScale})`, transformOrigin: 'center center' } : {}) }}
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
            <div style={{ width: 80, opacity: 0.18 }}>
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
              height: 261,
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
            <div style={{ width: 32, opacity: 0.2, marginBottom: 'auto', alignSelf: 'flex-end', marginTop: 20 }}>
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
              {t(style.name)}
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
              {t(style.sub)}
            </p>
          </div>
        ))}
      </div>
    </section>
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
    price: '$0.99',
    sub: 'one-time',
    tokens: 8,
    perToken: '12¢',
    tokenLabel: '8 haircut generations',
    line: '8 custom renders for less than a buck. Test a fade, a crop, and a taper before your next appointment.',
    cta: 'Try 8 looks',
    featured: false,
    freeOnly: false,
  },
  {
    id: 'popular',
    label: 'Explorer',
    price: '$4.99',
    sub: 'one-time',
    tokens: 50,
    perToken: '10¢',
    tokenLabel: '50 haircut generations',
    line: '50 looks to explore. Find what works for your face shape, then walk in with a reference photo.',
    cta: 'Get 50 looks',
    featured: true,
    freeOnly: false,
  },
  {
    id: 'pro',
    label: 'Pro',
    price: '$14.99',
    sub: 'one-time',
    tokens: 200,
    perToken: '7.5¢',
    tokenLabel: '200 haircut generations',
    line: 'Serious about your hair. 200 looks at 7.5¢ each — experiment until you find a signature style.',
    cta: 'Get 200 looks',
    featured: false,
    freeOnly: false,
  },
] as const;

/* ─────────────── Pricing CTA Button ─────────────── */
const POPULAR_RING_POS = [
  { x: 28, y: 30, delay: 30  },
  { x: 70, y: 68, delay: 110 },
  { x: 78, y: 26, delay: 0   },
  { x: 38, y: 74, delay: 80  },
] as const;

function PricingCTAButton({
  variant,
  children,
  onClick,
  disabled = false,
}: {
  variant: 'free' | 'starter' | 'popular' | 'pro';
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [btnSize, setBtnSize] = useState({ w: 260, h: 46 });
  const isMobile = useIsMobile();

  useLayoutEffect(() => {
    if (!btnRef.current) return;
    const ro = new ResizeObserver(() => {
      if (!btnRef.current) return;
      setBtnSize({ w: btnRef.current.offsetWidth, h: btnRef.current.offsetHeight });
    });
    ro.observe(btnRef.current);
    return () => ro.disconnect();
  }, []);

  const onEnterBtn = () => { setHovered(true); setAnimKey(k => k + 1); };
  const onLeaveBtn = () => { setHovered(false); };

  const fillColor =
    variant === 'pro' ? 'rgb(240,70,130)' :
    variant === 'popular'  ? 'rgb(80,150,255)'  :
    variant === 'starter'  ? 'rgb(248,200,24)'  :
    'rgba(255,248,234,0.92)';
  const hoverText = (variant === 'popular' || variant === 'pro') ? '#ffffff' : 'rgba(42,32,26,0.9)';
  const baseStyle: React.CSSProperties =
    variant === 'popular'  ? { border: '1px solid rgba(55,110,210,0.5)',  background: 'rgba(55,110,210,0.22)', color: 'rgba(255,248,234,0.78)', boxShadow: '0 4px 22px rgba(55,110,210,0.18)' } :
    variant === 'pro' ? { border: '1px solid rgba(220,70,120,0.43)', background: 'rgba(220,70,120,0.05)', color: 'rgba(255,248,234,0.82)' } :
    variant === 'starter'  ? { border: '1px solid rgba(248,200,24,0.32)', background: 'rgba(248,200,24,0.06)', color: 'var(--cream)' } :
                             { border: '1px solid rgba(255,248,234,0.18)', background: 'rgba(255,248,234,0.07)', color: 'var(--cream)' };

  const LT_BR = 12;
  const ringColor =
    variant === 'starter'  ? 'rgba(255,238,148,0.88)' :
    variant === 'pro' ? 'rgba(255,190,218,0.88)' :
    'rgba(255,255,255,0.85)';
  const hoverScale = variant === 'pro' ? 'scale(1.14)' : variant === 'popular' ? 'scale(1.05)' : 'scale(1.04)';
  const hoverShadow =
    variant === 'popular'  ? '0 8px 48px -2px rgba(80,150,255,0.95), 0 0 56px rgba(80,150,255,0.65), 0 0 100px rgba(80,150,255,0.28)' :
    variant === 'pro' ? '0 8px 40px -4px rgba(240,70,130,0.7), 0 0 32px rgba(240,70,130,0.38)' :
    variant === 'starter'  ? '0 8px 28px -4px rgba(248,200,24,0.45), 0 0 16px rgba(248,200,24,0.24)' :
                             '0 8px 28px -4px rgba(255,248,234,0.32), 0 0 14px rgba(255,248,234,0.12)';

  return (
    <div
      style={{
        position: 'relative',
        transition: 'transform 340ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 280ms ease',
        transform: hovered ? hoverScale : 'scale(1)',
        boxShadow: hovered ? hoverShadow : undefined,
        borderRadius: LT_BR,
      }}
      onMouseEnter={onEnterBtn}
      onMouseLeave={onLeaveBtn}
    >
      <button
        ref={btnRef}
        onClick={onClick}
        disabled={disabled}
        style={{
          position: 'relative', overflow: 'hidden',
          width: '100%', padding: isMobile ? '18px 16px' : (variant === 'pro' ? '12px 15px' : '13px 16px'),
          fontFamily: 'var(--font-dmsans), sans-serif',
          fontSize: isMobile ? 16 : (variant === 'pro' ? 12 : 13), fontWeight: 700, borderRadius: LT_BR,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          display: 'block',
          ...baseStyle,
        }}
      >
        {/* Main fill — inset rect matching button shape */}
        <span aria-hidden style={{
          position: 'absolute', inset: 0,
          background: fillColor,
          clipPath: hovered ? `inset(0% round ${LT_BR - 1}px)` : `inset(50%)`,
          transition: 'clip-path 240ms cubic-bezier(0.16,1,0.3,1)',
          pointerEvents: 'none', zIndex: 0,
        }} />

        {/* Starter: expanding ring */}
        {variant === 'starter' && hovered && (
          <span key={`ring-${animKey}`} aria-hidden style={{
            position: 'absolute', left: '50%', top: '50%',
            width: 2, height: 2, borderRadius: '50%',
            transform: 'translate(-50%,-50%)',
            pointerEvents: 'none', zIndex: 1,
            animation: 'starter-ring-grow 720ms cubic-bezier(0.16,1,0.3,1) forwards',
          }} />
        )}

        {/* Popular: four expanding circle rings */}
        {variant === 'popular' && hovered && POPULAR_RING_POS.map((p, i) => (
          <span key={`pcircle-${animKey}-${i}`} aria-hidden style={{
            position: 'absolute', left: `${p.x}%`, top: `${p.y}%`,
            width: 2, height: 2, borderRadius: '50%',
            transform: 'translate(-50%,-50%)',
            pointerEvents: 'none', zIndex: 1,
            animation: `popular-circle-grow 780ms ${p.delay}ms cubic-bezier(0.16,1,0.3,1) forwards`,
          }} />
        ))}

        {/* Pro: four expanding pink circle rings */}
        {variant === 'pro' && hovered && POPULAR_RING_POS.map((p, i) => (
          <span key={`ltcircle-${animKey}-${i}`} aria-hidden style={{
            position: 'absolute', left: `${p.x}%`, top: `${p.y}%`,
            width: 2, height: 2, borderRadius: '50%',
            transform: 'translate(-50%,-50%)',
            pointerEvents: 'none', zIndex: 1,
            animation: `pro-circle-grow 780ms ${p.delay}ms cubic-bezier(0.16,1,0.3,1) forwards`,
          }} />
        ))}

        {/* Text — sits above all fills */}
        <span style={{
          position: 'relative', zIndex: 5, display: 'block', textAlign: 'center',
          color: hovered ? hoverText : undefined,
          transition: 'color 200ms ease',
        }}>
          {children}
        </span>
      </button>

      {/* CW tracing ring — outside overflow:hidden so it hugs the actual button border */}
      {variant !== 'free' && (
        <svg
          aria-hidden
          style={{
            position: 'absolute',
            top: -1, left: -1,
            width: btnSize.w + 2, height: btnSize.h + 2,
            pointerEvents: 'none', zIndex: 2, overflow: 'visible',
            opacity: hovered ? 1 : 0,
            transition: hovered ? 'opacity 40ms ease 10ms' : 'opacity 100ms ease',
          }}
        >
          {/* CW path: top → right → bottom → left */}
          <path
            d={`M ${1 + LT_BR} 1 L ${1 + btnSize.w - LT_BR} 1 A ${LT_BR} ${LT_BR} 0 0 1 ${1 + btnSize.w} ${1 + LT_BR} L ${1 + btnSize.w} ${1 + btnSize.h - LT_BR} A ${LT_BR} ${LT_BR} 0 0 1 ${1 + btnSize.w - LT_BR} ${1 + btnSize.h} L ${1 + LT_BR} ${1 + btnSize.h} A ${LT_BR} ${LT_BR} 0 0 1 1 ${1 + btnSize.h - LT_BR} L 1 ${1 + LT_BR} A ${LT_BR} ${LT_BR} 0 0 1 ${1 + LT_BR} 1 Z`}
            fill="none"
            stroke={ringColor}
            strokeWidth="2"
            pathLength={1000}
            strokeDasharray={1000}
            strokeDashoffset={hovered ? 0 : 1000}
            style={{
              transition: hovered
                ? 'stroke-dashoffset 360ms cubic-bezier(0.4, 0, 0.2, 1) 20ms'
                : 'stroke-dashoffset 195ms cubic-bezier(0.6, 0, 0.8, 0)',
            }}
          />
        </svg>
      )}
    </div>
  );
}

/* ─────────────── Trace-Border CTA ─────────────── */
function TraceBorderCta({
  onClick,
  children,
  variant,
  style,
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant: 'blue' | 'tomato';
  style?: React.CSSProperties;
}) {
  const [hovered, setHovered] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    if (!btnRef.current) return;
    const update = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      setDims({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(btnRef.current);
    return () => ro.disconnect();
  }, []);

  const isBlue     = variant === 'blue';
  const TRACE_INSET = isBlue ? 3 : 2;
  const STROKE_W    = isBlue ? 1.5 : 3.75;
  const BR = 18;
  const rx = Math.max(2, BR - TRACE_INSET);
  const rw = Math.max(0, dims.w - TRACE_INSET * 2);
  const rh = Math.max(0, dims.h - TRACE_INSET * 2);
  const perimeter = dims.w > 0
    ? 2 * ((rw - 2 * rx) + (rh - 2 * rx)) + 2 * Math.PI * rx
    : 0;

  if (isBlue) {
    return (
      <button
        ref={btnRef}
        onClick={onClick}
        style={{
          position: 'relative', overflow: 'hidden',
          borderRadius: BR,
          border: 'none',
          background: "url('/dark_charcoal.png') center/cover no-repeat",
          cursor: 'pointer',
          transition: 'transform 300ms cubic-bezier(0.34,1.56,0.64,1)',
          transform: hovered ? 'scale(1.07)' : 'scale(1)',
          ...style,
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Blue fill — always visible at rest */}
        <span aria-hidden style={{
          position: 'absolute', inset: 0,
          background: 'rgb(80,150,255)',
          clipPath: `inset(${TRACE_INSET}px round ${rx}px)`,
          pointerEvents: 'none', zIndex: 0,
        }} />

        {/* White fill — grows in on hover */}
        <span aria-hidden style={{
          position: 'absolute', inset: 0,
          background: 'white',
          clipPath: hovered ? `inset(0% round ${BR}px)` : `inset(50% round ${rx}px)`,
          transition: 'clip-path 330ms cubic-bezier(0.16,1,0.3,1)',
          pointerEvents: 'none', zIndex: 1,
        }} />

        {/* White SVG outline — always drawn */}
        {perimeter > 0 && (
          <svg
            aria-hidden
            viewBox={`0 0 ${dims.w} ${dims.h}`}
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              pointerEvents: 'none', zIndex: 2,
            }}
          >
            <rect
              x={TRACE_INSET} y={TRACE_INSET}
              width={rw} height={rh}
              rx={rx} ry={rx}
              fill="none"
              stroke="white"
              strokeWidth={STROKE_W}
            />
          </svg>
        )}

        {/* Text */}
        <span style={{
          position: 'relative', zIndex: 3,
          color: hovered ? 'var(--char)' : 'var(--cream)',
          transition: 'color 200ms ease',
        }}>
          {children}
        </span>
      </button>
    );
  }

  // Tomato variant
  return (
    <button
      ref={btnRef}
      onClick={onClick}
      style={{
        position: 'relative', overflow: 'hidden',
        borderRadius: BR,
        border: 'none',
        background: 'rgba(255,248,234,0.97)',
        color: 'var(--tomato)',
        cursor: 'pointer',
        transition: 'transform 300ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 250ms ease',
        transform: hovered ? 'scale(1.04)' : 'scale(1)',
        boxShadow: hovered ? '0 0 0 1.5px rgba(90,72,55,0)' : '0 0 0 1.5px rgba(90,72,55,0.40)',
        ...style,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Tomato fill — expands on hover */}
      <span aria-hidden style={{
        position: 'absolute', inset: 0,
        background: 'var(--tomato)',
        clipPath: hovered ? `inset(0% round ${BR}px)` : `inset(50% round ${rx}px)`,
        transition: 'clip-path 330ms cubic-bezier(0.16,1,0.3,1)',
        pointerEvents: 'none', zIndex: 0,
      }} />

      {/* Golden SVG trace — draws on hover */}
      {perimeter > 0 && (
        <svg
          aria-hidden
          viewBox={`0 0 ${dims.w} ${dims.h}`}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            pointerEvents: 'none', zIndex: 1,
            filter: hovered
              ? 'drop-shadow(0 0 5px rgba(255,210,40,0.85)) drop-shadow(0 0 12px rgba(255,180,0,0.55))'
              : undefined,
            transition: 'filter 200ms ease',
          }}
        >
          <rect
            x={TRACE_INSET} y={TRACE_INSET}
            width={rw} height={rh}
            rx={rx} ry={rx}
            fill="none"
            stroke="rgba(255,210,40,0.92)"
            strokeWidth={STROKE_W}
            strokeDasharray={perimeter}
            strokeDashoffset={hovered ? 0 : perimeter}
            style={{ transition: `stroke-dashoffset ${hovered ? '415ms' : '106ms'} cubic-bezier(0.16,1,0.3,1)` }}
          />
        </svg>
      )}

      {/* Text */}
      <span style={{
        position: 'relative', zIndex: 2,
        color: hovered ? 'var(--cream)' : undefined,
        transition: 'color 200ms ease',
      }}>
        {children}
      </span>
    </button>
  );
}

function LandingPricingCards({ onPricingClick, checkoutLoading }: { onPricingClick: (planId: string) => void; checkoutLoading: string | null }) {
  const t = useT();
  const isMobile = useIsMobile();
  return (
    <div id="pricing" style={{ padding: '0 0 72px' }}>
      <Reveal>
      {/* Curved outer box — identical to standalone pricing page */}
      <div className="pricing-led-border" style={{
        borderRadius: 36,
        backgroundImage: 'url(/dark_charcoal.png)', backgroundSize: '768px auto', backgroundRepeat: 'repeat', backgroundPosition: 'top left',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '52px 56px 52px', borderBottom: '1px solid rgba(255,248,234,0.14)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16, ...(isMobile ? { padding: '36px 20px' } : {}) }}>
          <h2 style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontSize: 'clamp(2.8rem, 5vw, 4.2rem)', fontWeight: 900, color: 'var(--cream)', lineHeight: 0.95, margin: 0, letterSpacing: '-0.03em' }}>
            {t('pricing')}
          </h2>
          <p style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontStyle: 'italic', fontSize: 20, color: 'rgba(255,248,234,0.72)', margin: 0, maxWidth: 460, lineHeight: 1.3 }}>
            {t('See yourself in the cut before you sit in the chair.')}
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
                {t('avg barber visit')}
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
                {t('1 haircut generation')}
              </div>
              <div style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontSize: 'clamp(1.9rem, 2.6vw, 2.6rem)', fontWeight: 900, color: '#52ca78', lineHeight: 1, letterSpacing: '-0.03em' }}>
                8¢
              </div>
            </div>
          </div>
        </div>

        {/* Plan cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: '16px 20px 20px', ...(isMobile ? { gridTemplateColumns: '1fr' } : {}) }}>
          {PRICING_PLANS.map((plan) => {
            const isFeatured = plan.featured;
            return (
              <div
                key={plan.id}
                style={{
                  padding: '28px 24px 32px',
                  display: 'flex', flexDirection: 'column',
                  borderRadius: 16,
                  border: isFeatured
                    ? '1px solid rgba(80,150,255,0.55)'
                    : '1px solid rgba(255,248,234,0.14)',
                  background: isFeatured
                    ? 'linear-gradient(160deg, rgba(255,248,234,0.1) 0%, rgba(255,248,234,0.05) 100%)'
                    : 'rgba(255,248,234,0.04)',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                  boxShadow: isFeatured
                    ? '0 8px 40px rgba(80,150,255,0.18), inset 0 1px 0 rgba(255,248,234,0.13)'
                    : 'inset 0 1px 0 rgba(255,248,234,0.09)',
                  position: 'relative',
                }}
              >
                {isFeatured && (
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'rgba(80,150,255,0.9)', borderRadius: '16px 16px 0 0' }} />
                )}

                <div style={{
                  fontFamily: 'var(--font-jetbrains), monospace',
                  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.18em', fontWeight: 600,
                  color: isFeatured ? 'rgba(80,150,255,0.9)' : 'rgba(255,248,234,0.58)',
                  marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  {t(plan.label)}
                  {isFeatured && (
                    <span style={{ background: 'rgba(80,150,255,0.2)', color: 'rgba(80,150,255,0.9)', borderRadius: 9999, padding: '2px 8px', fontSize: 9 }}>
                      {t('popular')}
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
                  {plan.perToken ? '' : t(plan.sub)}
                </div>

                <div style={{ borderTop: '1px solid rgba(255,248,234,0.13)', marginBottom: 18 }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    background: plan.id === 'starter' ? 'rgba(248,200,24,0.18)' : plan.id === 'pro' ? 'rgba(240,70,130,0.18)' : plan.freeOnly ? 'rgba(255,248,234,0.07)' : 'rgba(80,150,255,0.18)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <img src="/shapeup_token.png" alt="token" draggable={false} style={{ width: 26, height: 26, borderRadius: '50%', display: 'block' }} />
                  </div>
                  <span style={{ fontFamily: 'var(--font-dmsans), sans-serif', fontSize: 15, fontWeight: 700, color: 'var(--cream)' }}>
                    {t(plan.tokenLabel)}
                  </span>
                </div>

                <p style={{
                  fontFamily: 'var(--font-dmsans), sans-serif',
                  fontSize: 13, color: 'rgba(255,248,234,0.64)', lineHeight: 1.55,
                  margin: '0 0 24px', flex: 1,
                }}>
                  {t(plan.line)}
                </p>

                <PricingCTAButton
                  variant={plan.id}
                  onClick={() => onPricingClick(plan.id)}
                  disabled={checkoutLoading === plan.id}
                >
                  {checkoutLoading === plan.id ? '…' : t(plan.cta)}
                </PricingCTAButton>
              </div>
            );
          })}
        </div>

        {/* Footer note inside the box */}
        <div style={{ padding: '20px 56px 24px', borderTop: '1px solid rgba(255,248,234,0.13)', textAlign: 'center' }}>
          <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(255,248,234,0.42)' }}>
            {t('one-time purchase · no subscription · secured by stripe')}
          </span>
        </div>
      </div>
      </Reveal>
    </div>
  );
}

/* ─────────────── Animated border card ─────────────── */
function BorderAnimCard({
  children,
  style,
  delay = 0,
  duration = 2200,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  delay?: number;
  duration?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const hasPlayedRef = useRef(false);
  const animIdRef = useRef(`ba-${Math.random().toString(36).slice(2, 8)}`);
  const animId = animIdRef.current;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        setDims({ w: containerRef.current.offsetWidth, h: containerRef.current.offsetHeight });
      }
    });
    ro.observe(el);
    setDims({ w: el.offsetWidth, h: el.offsetHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasPlayedRef.current) {
          hasPlayedRef.current = true;
          setTimeout(() => setPlaying(true), delay);
        }
      },
      { threshold: 0.5 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);

  const R = 18;
  const SW = 3;
  const perim = dims ? 2 * ((dims.w - 2 * R) + (dims.h - 2 * R)) + 2 * Math.PI * R : 0;

  // Corner-aware keyframes: SVG <rect> stroke starts at top-left, goes CW.
  // Corners get 2.5x time-cost so the tip visibly eases through turns.
  const cssText =
    dims && perim > 0
      ? (() => {
          const { w, h } = dims;
          const arc = Math.PI * R / 2;
          const CORNER_FACTOR = 2.5;
          const segs: [number, boolean][] = [
            [w - 2 * R, false],
            [arc, true],
            [h - 2 * R, false],
            [arc, true],
            [w - 2 * R, false],
            [arc, true],
            [h - 2 * R, false],
            [arc, true],
          ];
          const adjTotal = segs.reduce((s, [len, isC]) => s + len * (isC ? CORNER_FACTOR : 1), 0);
          const DRAW_START = 4,
            DRAW_END = 88,
            DRAW_RANGE = DRAW_END - DRAW_START;
          const lines = [
            `  0%   { stroke-dashoffset: ${perim.toFixed(1)}; opacity: 0; }`,
            `  4%   { stroke-dashoffset: ${(perim * 0.97).toFixed(1)}; opacity: 1; }`,
          ];
          let pos = 0,
            adjSoFar = 0;
          for (const [len, isC] of segs) {
            pos += len;
            adjSoFar += len * (isC ? CORNER_FACTOR : 1);
            const pct = DRAW_START + (adjSoFar / adjTotal) * DRAW_RANGE;
            const dashoffset = Math.max(0, perim - pos);
            if (pct > 4.5 && pct < 87.5) {
              lines.push(`  ${pct.toFixed(1)}% { stroke-dashoffset: ${dashoffset.toFixed(1)}; }`);
            }
          }
          lines.push(`  88%  { stroke-dashoffset: 0; opacity: 1; }`);
          lines.push(`  100% { stroke-dashoffset: 0; opacity: 0; }`);
          return [
            `@keyframes ${animId} {\n${lines.join("\n")}\n}`,
            `@keyframes ${animId}-shine { from { transform: translateX(-130%) skewX(-15deg); } to { transform: translateX(300%) skewX(-15deg); } }`,
          ].join("\n");
        })()
      : "";

  return (
    <div ref={containerRef} style={{ position: "relative", ...style }}>
      {children}
      {dims && perim > 0 && (
        <>
          <style>{cssText}</style>
          {/* Shine fires at delay+380ms so the 3 cards flash left-right in sequence */}
          <div
            style={{
              position: "absolute",
              top: "-10%",
              left: 0,
              width: "55%",
              height: "120%",
              background:
                "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.13) 50%, transparent 100%)",
              transform: "translateX(-130%) skewX(-15deg)",
              animation: playing
                ? `${animId}-shine 600ms cubic-bezier(0.2,0,0.4,1) 380ms forwards`
                : "none",
              pointerEvents: "none",
              zIndex: 3,
            }}
          />
        </>
      )}
    </div>
  );
}

function NeonCornersOverlay({ color, seed }: { color: string; seed: number }) {
  const SW = 3;
  const o = SW / 2;
  const eff = 20; // arc radius (card has borderRadius:18, slight inset)
  const ar = eff - o;

  // [active, armH, armV] per corner: TL, TR, BR, BL
  // Not all corners active; arms are long and intentionally asymmetric
  const CONFIGS: [boolean, number, number][][] = [
    // seed 0 (green): TL + BR — diagonal highlight
    [[true, 34, 16], [false, 0, 0], [true, 18, 40], [false, 0, 0]],
    // seed 1 (blue): TR + BL — opposite diagonal
    [[false, 0, 0], [true, 24, 42], [false, 0, 0], [true, 38, 20]],
    // seed 2 (violet): TL + TR + BL — three corners, asymmetric
    [[true, 20, 40], [true, 36, 18], [false, 0, 0], [true, 16, 32]],
  ];

  const corners = CONFIGS[seed % CONFIGS.length];
  const glow = `drop-shadow(0 0 4px ${color}) drop-shadow(0 0 9px ${color})`;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
      {corners.map(([active, armH, armV], idx) => {
        if (!active) return null;
        const w = eff + armH + o;
        const h = eff + armV + o;
        let d: string;
        let pos: React.CSSProperties;
        switch (idx) {
          case 0: // TL: left arm down → arc → top arm right
            d = `M ${o} ${eff + armV} L ${o} ${eff} A ${ar} ${ar} 0 0 1 ${eff} ${o} L ${eff + armH} ${o}`;
            pos = { top: 0, left: 0 };
            break;
          case 1: // TR: top arm left → arc → right arm down
            d = `M ${o} ${o} L ${w - eff} ${o} A ${ar} ${ar} 0 0 1 ${w - o} ${eff} L ${w - o} ${eff + armV}`;
            pos = { top: 0, right: 0 };
            break;
          case 2: // BR: right arm up → arc → bottom arm left
            d = `M ${w - o} ${o} L ${w - o} ${h - eff} A ${ar} ${ar} 0 0 1 ${w - eff} ${h - o} L ${o} ${h - o}`;
            pos = { bottom: 0, right: 0 };
            break;
          default: // BL: left arm down → arc → bottom arm right
            d = `M ${o} ${o} L ${o} ${h - eff} A ${ar} ${ar} 0 0 0 ${eff} ${h - o} L ${eff + armH} ${h - o}`;
            pos = { bottom: 0, left: 0 };
        }
        return (
          <svg key={idx} width={w} height={h} viewBox={`0 0 ${w} ${h}`}
            style={{ position: 'absolute', ...pos, filter: glow, opacity: 0.9, pointerEvents: 'none' }}>
            <path d={d} fill="none" stroke={color} strokeWidth={SW} strokeLinecap="round" />
          </svg>
        );
      })}
    </div>
  );
}

function LandingPage({ onEnter }: { onEnter: () => void }) {
  const t = useT();
  const isMobile = useIsMobile();
  const swipeTriggerRef = useRef<((dir: 'up' | 'down') => void) | null>(null);
  const faceScrollRef = useRef<{ goNext: () => void; goPrev: () => void } | null>(null);

  const { isSignedIn } = useUser();
  const meUser = useQuery(api.users.getMe);
  const [pendingAction, setPendingAction] = useState<null | { type: 'free' } | { type: 'paid'; planId: string }>(null);
  const [authVisible, setAuthVisible] = useState(false);
  const [authClosing, setAuthClosing] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [checkoutPending, setCheckoutPending] = useState(false);

  // If returning from Google OAuth with a pending checkout, show a loading screen
  // immediately (before first paint) so the user never sees the landing page.
  useLayoutEffect(() => {
    if (sessionStorage.getItem('pendingPlanId')) setCheckoutPending(true);
  }, []);

  useEffect(() => {
    if (pendingAction) {
      requestAnimationFrame(() => requestAnimationFrame(() => setAuthVisible(true)));
    }
  }, [pendingAction]);

  // After Google OAuth redirect, isSignedIn flips to true on a fresh page load.
  // pendingAction state is gone, so we recover the plan from sessionStorage.
  useEffect(() => {
    if (!isSignedIn) return;
    const planId = sessionStorage.getItem('pendingPlanId');
    if (!planId) return;
    sessionStorage.removeItem('pendingPlanId');
    runCheckout(planId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  const dismissAuth = () => {
    setAuthClosing(true);
    setTimeout(() => { setPendingAction(null); setAuthVisible(false); setAuthClosing(false); }, 320);
  };

  const runCheckout = async (planId: string) => {
    sessionStorage.setItem('preCheckoutCredits', String(meUser?.credits ?? 0));
    setCheckoutLoading(planId);
    try {
      await startCheckout({ plan: planId, source: 'landing_page' });
    } finally { setCheckoutLoading(null); }
  };

  const handleFreeTry = () => {
    if (isSignedIn) { onEnter(); return; }
    setPendingAction({ type: 'free' });
  };

  const handlePricingClick = (planId: string) => {
    if (!isSignedIn) { setPendingAction({ type: 'paid', planId }); return; }
    if (planId === 'free') { onEnter(); return; }
    if (checkoutLoading) return;
    runCheckout(planId);
  };

  const handleAuthDone = () => {
    const action = pendingAction;
    setPendingAction(null);
    setAuthVisible(false);
    setAuthClosing(false);
    if (!action || action.type === 'free') { onEnter(); return; }
    runCheckout(action.planId);
  };

  const smoothScrollTo = (id: string, extraOffset = 0) => {
    const el = document.getElementById(id);
    if (!el) return;
    const start = window.scrollY;
    const end = el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.1 + extraOffset;
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
  const [logoHover, setLogoHover] = useState(false);

  if (checkoutPending) {
    return (
      <div style={{
        position: 'fixed', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: '#faf9f6', gap: 20,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          border: '3px solid #e5e3de',
          borderTopColor: '#c0392b',
          animation: 'spin 0.75s linear infinite',
        }} />
        <span style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontSize: 18, color: '#555', fontWeight: 600 }}>
          Opening checkout…
        </span>
      </div>
    );
  }

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

      <div className="relative z-10" style={{ maxWidth: 1320, margin: '0 auto', padding: '16px 56px 56px', ...(isMobile ? { padding: '14px 20px 40px' } : {}) }}>

        {/* ── Nav ── */}
        <nav className="anim-fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 5, ...(isMobile ? { gap: 10 } : {}) }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'default' }}
            onMouseEnter={() => setLogoHover(true)}
            onMouseLeave={() => setLogoHover(false)}
          >
            <div style={{ width: 46 }}><BarberMascot isStatic={!logoHover} snap={logoHover} color="#2a201a" /></div>
            <div className="type-chonk" style={{ fontSize: 30, lineHeight: 1, margin: 0, color: 'var(--ink)', ...(isMobile ? { fontSize: 22 } : {}) }}>
              shape<em style={{ color: 'var(--tomato)' }}>up</em>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, ...(isMobile ? { gap: 12 } : {}) }}>
            {/* Desktop fits all three. Mobile only has room for two, so "how it
                works" is dropped there, leaving pricing + contact us. */}
            {!isMobile && (
              <>
                <button
                  onClick={scrollToHowItWorks}
                  className="font-serif italic nav-link-squiggle"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--char)', fontSize: 16, opacity: 0.7, transition: 'opacity 140ms ease, background-size 340ms cubic-bezier(.2,.85,.2,1)' }}
                  onMouseEnter={e => ((e.target as HTMLElement).style.opacity = '1')}
                  onMouseLeave={e => ((e.target as HTMLElement).style.opacity = '0.7')}
                >
                  how it works
                </button>
                <span aria-hidden style={{ width: 1, height: 15, background: 'rgba(42,32,26,0.22)', flexShrink: 0 }} />
              </>
            )}
            <button
              onClick={scrollToPricing}
              className="font-serif italic nav-link-squiggle"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--char)', fontSize: 16, opacity: 0.7, transition: 'opacity 140ms ease, background-size 340ms cubic-bezier(.2,.85,.2,1)', ...(isMobile ? { fontSize: 15 } : {}) }}
              onMouseEnter={e => ((e.target as HTMLElement).style.opacity = '1')}
              onMouseLeave={e => ((e.target as HTMLElement).style.opacity = '0.7')}
            >
              pricing
            </button>
            <span aria-hidden style={{ width: 1, height: 15, background: 'rgba(42,32,26,0.22)', flexShrink: 0, ...(isMobile ? { height: 18 } : {}) }} />
            <Link
              href="/contact"
              className="font-serif italic"
              style={{ textDecoration: 'none', color: 'var(--char)', fontSize: 16, opacity: 0.7, transition: 'opacity 140ms ease', ...(isMobile ? { fontSize: 15 } : {}) }}
              onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
              onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '0.7')}
            >
              contact us
            </Link>
          </div>
          <BouncyButton
            onClick={() => { window.location.href = '/dashboard'; }}
            className="btn-tomato btn-lift-half"
            style={{ padding: '11px 22px', fontSize: 13, borderRadius: 10 }}
          >
            {t('dashboard')}
          </BouncyButton>
        </nav>

        {/* ── Hero ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.1fr 1fr',
            gap: 56,
            alignItems: 'center',
            marginTop: 36,
            position: 'relative',
            ...(isMobile ? { gridTemplateColumns: '1fr', gap: 24, marginTop: 24 } : {}),
          }}
        >
          {/* Left */}
          <div style={{ position: 'relative', zIndex: 2, textAlign: 'center' }}>
            <div className="hero-rise" style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: 'rgba(217,78,58,0.07)', border: '1px solid rgba(217,78,58,0.25)', borderRadius: 9999, padding: '8px 20px', marginTop: 8 }}>
              <span className="star-twinkle" style={{ color: 'var(--tomato)', fontSize: 10, ...(isMobile ? { fontSize: 12 } : {}) }}>✦</span>
              <span className="font-mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--char)', opacity: 0.8, ...(isMobile ? { fontSize: 13, letterSpacing: '0.14em' } : {}) }}>{t('Free to try · No credit card · 3D preview in ~60 sec')}</span>
            </div>
            <div
              className="type-chonk"
              style={{ fontSize: 'clamp(2rem, 3.8vw, 3rem)', marginTop: 16, color: 'var(--ink)', lineHeight: 1.05, ...(isMobile ? { fontSize: 'clamp(2.5rem, 4.8vw, 3.7rem)', marginTop: 26, lineHeight: 1.1 } : {}) }}
            >
              <div className="hero-rise delay-100">{t('see it first.')}</div>
              <div className="hero-rise delay-200"><em style={{ color: 'var(--tomato)' }}>{t('love')}</em> {t('it more.')}</div>
            </div>

            <p
              className="font-serif italic hero-rise delay-300"
              style={{ fontSize: 18, color: 'var(--char)', maxWidth: 480, margin: '22px auto 0', lineHeight: 1.5, ...(isMobile ? { fontSize: 16, maxWidth: 520, margin: '28px auto 0', lineHeight: 1.62 } : {}) }}
            >
              {t('Take one selfie. See 10+ haircuts on your actual 3D face.')}
              <br />{t('Walk into the barber knowing exactly what you want.')}
            </p>

            <div className="hero-rise delay-400" style={{ display: 'flex', justifyContent: 'center', marginTop: 34 }}>
              <SignUpWidget onEnter={onEnter} />
            </div>
          </div>

          {/* Right — blob visual */}
          <div
            style={{ position: 'relative', height: 640, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', ...(isMobile ? { height: 'auto', justifyContent: 'center' } : {}) }}
            className="hero-blob-in"
          >
            <div style={{ position: 'relative', width: 624, zIndex: 1, ...(isMobile ? { width: '100%', maxWidth: 360 } : {}) }}>
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
                isMobile={isMobile}
              />
            </div>
          </div>
        </div>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/transition2.png" alt="" style={{ display: 'block', width: '100%' }} />

      <div style={{ backgroundImage: 'url(/white.png)', backgroundSize: 'cover', backgroundPosition: 'center', paddingBottom: 80 }}>
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: '0 56px', ...(isMobile ? { padding: '0 20px' } : {}) }}>

        {/* ── Problem section ── */}
        <div style={{ padding: '58px 0 0' }}>
          <Reveal>
            <p className="font-mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.18em', color: 'var(--tomato)', textAlign: 'center', marginBottom: 22 }}>
              {t('sound familiar?')}
            </p>
          </Reveal>
          <Reveal delay={80}>
            <h2
              className="type-chonk"
              style={{ fontSize: 'clamp(1.9rem, 3.2vw, 2.8rem)', color: 'var(--ink)', textAlign: 'center', lineHeight: 1.05, marginBottom: 18 }}
            >
              {t('You describe it.')}
              <br />
              <em style={{ color: 'var(--tomato)' }}>{t('They hear something different.')}</em>
            </h2>
          </Reveal>
          <Reveal delay={160}>
            <p style={{ fontFamily: 'Montserrat, sans-serif', fontWeight: 500, fontSize: 17, color: 'var(--char)', textAlign: 'center', maxWidth: 500, margin: '0 auto 56px', lineHeight: 1.65 }}>
              {t('You walk out of the barber disappointed — not because your barber was bad, but because there was no way to show exactly what you meant.')}
            </p>
          </Reveal>

          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 0, ...(isMobile ? { gridTemplateColumns: '1fr' } : {}) }}>
            {[
              {
                stat: '~6 weeks',
                label: 'to grow back a bad cut',
                desc: 'A bad cut takes time to go away. Hair grows about half an inch a month.',
              },
              {
                stat: '$45+ a visit',
                label: 'no preview, full commitment',
                desc: 'You bind yourself to paying before you see anything, with no refunds :(',
              },
              {
                stat: '1 in 3',
                label: 'leave wishing they\'d said more',
                desc: 'The cut isn\'t what you wanted. Yet you stay quiet in the chair.',
              },
            ].map((item, i) => (
              <Reveal key={i} delay={i * 110} wonk={[-0.7, 0.5, -0.5][i]}>
                <div
                  className="stat-card"
                  style={{ '--card-wonk': `${[-0.6, 0.6, -0.4][i]}deg` } as React.CSSProperties}
                >
                  <div
                    className="font-display"
                    style={{ fontStyle: 'italic', fontVariationSettings: "'SOFT' 100, 'WONK' 0, 'opsz' 144", fontWeight: 900, fontSize: 'clamp(1.5rem, 2.1vw, 2rem)', color: 'var(--tomato)', lineHeight: 1 }}
                  >
                    {t(item.stat)}
                  </div>
                  <div className="font-mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(42,32,26,0.62)', marginBottom: 4 }}>
                    {t(item.label)}
                  </div>
                  <div className="font-sans" style={{ fontSize: 15, color: 'var(--char)', lineHeight: 1.6 }}>
                    {t(item.desc)}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          {/* Bridge line */}
          <Reveal delay={120}>
            <p style={{ fontFamily: 'Montserrat, sans-serif', fontWeight: 500, fontSize: 18, color: 'var(--ink)', textAlign: 'center', lineHeight: 1.7, maxWidth: 600, margin: '48px auto' }}>
              {t('We show you how any hairstyle looks on your face. Then, we give your barber the steps to make it happen.')}
            </p>
          </Reveal>
        </div>

        {/* ── Value props bar ── */}
        <div style={{ margin: '0 0 0', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, ...(isMobile ? { gridTemplateColumns: '1fr' } : {}) }}>
          {([
            { stat: '60 secs', label: 'SCAN TO 3D PREVIEW', desc: 'Just one minute from selfie to full 3D model.', bgPos: '0%' },
            { stat: '1 selfie', label: 'ALL YOU NEED', desc: 'One photo is all it takes. Help us secure the best cut for you.', bgPos: '50%' },
            { stat: '$2', label: 'FOR 8 HAIRSTYLES', desc: 'Less than a coffee to see yourself in 8 different cuts.', bgPos: '100%' },
          ]).map((item, i) => (
            <Reveal key={i} delay={i * 100} wonk={[-0.5, 0.4, -0.4][i]}>
              <div className="value-card" style={{ '--card-wonk': `${[-0.6, 0.6, -0.4][i]}deg` } as React.CSSProperties}>
                {/* Image layer — brightness reduced by 25% */}
                <div style={{
                  position: 'absolute', inset: 0,
                  backgroundImage: `url(/3face_blur.png), url(/dark_charcoal.png)`,
                  backgroundSize: `300% auto, cover`,
                  backgroundPosition: `${item.bgPos} center, center`,
                  backgroundRepeat: `no-repeat, no-repeat`,
                  filter: 'brightness(0.75)',
                }} />
                {/* Dark overlay */}
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,6,4,0.60)' }} />
                {/* Content */}
                <div style={{ position: 'relative', zIndex: 1, padding: '34px 26px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontFamily: 'Montserrat, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 'clamp(1.5rem, 2.1vw, 2rem)', color: '#4fd6c0', lineHeight: 1 }}>
                    {t(item.stat)}
                  </div>
                  <div style={{ fontFamily: 'var(--font-dmsans), sans-serif', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(255,255,255,0.72)', marginBottom: 4 }}>
                    {t(item.label)}
                  </div>
                  <div style={{ fontFamily: 'var(--font-dmsans), sans-serif', fontSize: 15, color: 'rgba(255,255,255,0.85)', lineHeight: 1.6 }}>
                    {t(item.desc)}
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/transition2.png" alt="" style={{ display: 'block', width: '100%', transform: 'scaleY(-1)' }} />

      <div style={{ maxWidth: 1320, margin: '0 auto', padding: '0 56px 80px', ...(isMobile ? { padding: '0 20px 60px' } : {}) }}>

        {/* ── Steps ── */}
        <div id="how-it-works" style={{ marginTop: 48, paddingTop: 8 }}>
          <Reveal delay={80}>
            <h2
              className="type-chonk"
              style={{ fontSize: 'clamp(1.9rem, 3.2vw, 2.8rem)', color: 'var(--ink)', textAlign: 'center', lineHeight: 1.05, marginBottom: 14 }}
            >
              {t('how it')} <em style={{ color: 'var(--tomato)' }}>{t('works')}</em>.
            </h2>
          </Reveal>
          <Reveal delay={160}>
            <p className="font-serif italic" style={{ fontSize: 17, color: 'var(--char)', textAlign: 'center', maxWidth: 460, margin: '0 auto 52px', lineHeight: 1.55 }}>
              {t('This demo is live — send a message and try it yourself.')}
            </p>
          </Reveal>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, alignItems: 'stretch', position: 'relative', ...(isMobile ? { gridTemplateColumns: '1fr' } : {}) }}>

            {/* Step 1: Scan */}
            <Reveal wonk={-0.5} style={{ display: 'flex' }}>
            <div className="step-card" style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              borderRadius: 24, overflow: 'hidden',
              border: '1.5px solid rgba(42,32,26,0.08)',
            }}>
              {/* Dark header */}
              <div style={{
                background: '#2a201a',
                padding: '20px 22px 18px',
                display: 'flex', alignItems: 'center', gap: 13,
                borderBottom: '3px solid var(--tomato)',
              }}>
                <span className="step-num">
                  <Image src="/1.png" alt="Step 1" width={50} height={50} style={{ width: 50, height: 50, objectFit: 'contain' }} />
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontFamily: "var(--font-montserrat), 'Montserrat', sans-serif", fontSize: 22, fontWeight: 800, color: '#F5F1EA', letterSpacing: '0.01em', textTransform: 'uppercase', lineHeight: 1 }}>{t('Selfie')}</span>
                  <span className="font-mono" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(245,241,234,0.42)' }}>{t('30 seconds')}</span>
                </div>
              </div>
              {/* Body — one selfie, polaroid treatment */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--cream)', padding: '30px 22px 26px' }}>
                <div className="polaroid wonky-sm-l" style={{ width: '78%', padding: '10px 10px 40px' }}>
                  <div className="tape tape-tl" />
                  <div className="tape tape-tr" />
                  <Image
                    src="/landing_face2/face2_selfie.png"
                    alt="Scan your face"
                    width={600} height={600}
                    style={{ width: '100%', height: 'auto', borderRadius: 2, display: 'block' }}
                  />
                  <div style={{ position: 'absolute', bottom: 9, left: 0, right: 0, textAlign: 'center' }}>
                    <span className="font-display" style={{ fontStyle: 'italic', fontWeight: 500, fontSize: 15, color: 'var(--char)' }}>
                      {t('just one selfie')} ✂
                    </span>
                  </div>
                </div>
              </div>
            </div>
            </Reveal>

            {/* Step 2: Describe */}
            <Reveal delay={120} wonk={0.4} style={{ display: 'flex' }}>
            <div className="step-card" style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              borderRadius: 24, overflow: 'hidden',
              border: '1.5px solid rgba(42,32,26,0.08)',
            }}>
              {/* Dark header */}
              <div style={{
                background: '#2a201a',
                padding: '20px 22px 18px',
                display: 'flex', alignItems: 'center', gap: 13,
                borderBottom: '3px solid var(--tomato)',
              }}>
                <span className="step-num">
                  <Image src="/2.png" alt="Step 2" width={50} height={50} style={{ width: 50, height: 50, objectFit: 'contain' }} />
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontFamily: "var(--font-montserrat), 'Montserrat', sans-serif", fontSize: 22, fontWeight: 800, color: '#F5F1EA', letterSpacing: '0.01em', textTransform: 'uppercase', lineHeight: 1 }}>{t('Describe')}</span>
                  <span className="font-mono" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(245,241,234,0.42)' }}>{t('text it like a friend')}</span>
                </div>
              </div>
              {/* Body */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--cream)', padding: '24px 16px 20px', gap: 10 }}>
                <DescribePhoneDemo onSend={setDescribeActiveIdx} />
                <span className="font-mono" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'rgba(42,32,26,0.35)' }}>↑ {t('tap send — step 3 updates live')}</span>
              </div>
            </div>
            </Reveal>

            {/* Step 3: Show your barber */}
            <Reveal delay={240} wonk={-0.4} style={{ display: 'flex' }}>
            <div className="step-card" style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              borderRadius: 24, overflow: 'hidden',
              border: '1.5px solid rgba(42,32,26,0.08)',
            }}>
              {/* Dark header */}
              <div style={{
                background: '#2a201a',
                padding: '20px 22px 18px',
                display: 'flex', alignItems: 'center', gap: 13,
                borderBottom: '3px solid var(--tomato)',
              }}>
                <span className="step-num">
                  <Image src="/3.png" alt="Step 3" width={50} height={50} style={{ width: 50, height: 50, objectFit: 'contain' }} />
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontFamily: "var(--font-montserrat), 'Montserrat', sans-serif", fontSize: 22, fontWeight: 800, color: '#F5F1EA', letterSpacing: '0.01em', textTransform: 'uppercase', lineHeight: 1 }}>{t('Show your barber')}</span>
                  <span className="font-mono" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(245,241,234,0.42)' }}>{t('your 3D preview, live')}</span>
                </div>
              </div>
              {/* Body */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--cream)', padding: '28px 22px 24px' }}>
                <ShowBarberDemo activeIdx={describeActiveIdx} />
              </div>
            </div>
            </Reveal>

            {/* ── Connector badges — the pipeline, made visible (horizontal layout only) ── */}
            {/* 1 → 2: quiet, sequence only */}
            <Reveal delay={460} style={{ position: 'absolute', left: 'calc(33.333% - 3.3px)', top: '50%', marginLeft: -17, marginTop: -17, zIndex: 5, ...(isMobile ? { display: 'none' } : {}) }}>
              <div style={{
                width: 34, height: 34, borderRadius: '50%',
                background: 'var(--cream)', border: '1.5px solid rgba(42,32,26,0.18)',
                boxShadow: '0 6px 18px -4px rgba(42,32,26,0.28)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--ink)', fontWeight: 900, fontSize: 15,
                transform: 'rotate(-6deg)',
              }}>
                →
              </div>
            </Reveal>
            {/* 2 → 3: tomato, re-pops on every send — this link is live */}
            <Reveal delay={560} style={{ position: 'absolute', left: 'calc(66.667% + 3.3px)', top: '50%', marginLeft: -17, marginTop: -17, zIndex: 5, ...(isMobile ? { display: 'none' } : {}) }}>
              <div
                key={describeActiveIdx ?? -1}
                className={describeActiveIdx !== undefined ? 'popup-in' : ''}
                style={{
                  width: 34, height: 34, borderRadius: '50%',
                  background: 'var(--tomato)',
                  boxShadow: '0 6px 20px -4px rgba(217,78,58,0.6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--cream)', fontWeight: 900, fontSize: 15,
                }}
              >
                →
              </div>
            </Reveal>

          </div>
        </div>

        {/* ── Mid-page CTA ── */}
        <Reveal>
        <div style={{ textAlign: 'center', padding: '72px 0 16px' }}>
          <p className="font-serif italic" style={{ fontSize: 17, color: 'var(--char)', opacity: 0.6, margin: '0 0 20px' }}>
            {t('Ready to see your next cut?')}
          </p>
          <TraceBorderCta
            onClick={() => { window.location.href = '/dashboard'; }}
            variant="tomato"
            style={{
              padding: '18px 44px',
              fontSize: 20,
              fontFamily: 'var(--font-fraunces), Georgia, serif',
              fontVariationSettings: "'SOFT' 100, 'WONK' 0, 'opsz' 144",
              fontWeight: 900,
              letterSpacing: '-0.01em',
            }}
          >
            {t("Preview My Cut — It's Free")} →
          </TraceBorderCta>
          <p className="font-mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(42,32,26,0.38)', marginTop: 14 }}>
            {t('takes about 60 seconds · no account required')}
          </p>
        </div>
        </Reveal>

      </div>
      </div>

      {/* ── Transition image ── */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/transition.png" alt="" style={{ display: 'block', width: '100%' }} />

      {/* ── Dark charcoal section ── */}
      <div style={{ backgroundImage: 'url(/dark_charcoal.png)', backgroundSize: '768px auto', backgroundRepeat: 'repeat', backgroundPosition: 'top left' }}>
        <div style={{ maxWidth: 1320, margin: '0 auto', padding: '0 56px', ...(isMobile ? { padding: '0 20px' } : {}) }}>

          {/* ── Glimpse orbit section ── */}
          <GlimpseSection />

          {/* ── Pricing ── */}
          <LandingPricingCards onPricingClick={handlePricingClick} checkoutLoading={checkoutLoading} />

          {/* ── Orbit CTA ── */}
          <Reveal>
          <div style={{ textAlign: 'center', padding: '0 0 72px' }}>
            <p className="font-display" style={{ fontStyle: 'italic', fontVariationSettings: "'SOFT' 100, 'WONK' 0, 'opsz' 144", fontWeight: 700, fontSize: 'clamp(1.1rem, 1.8vw, 1.4rem)', color: 'rgba(255,248,234,0.6)', margin: '0 0 20px' }}>
              {t('Pick your style.')}
            </p>
            <TraceBorderCta
              onClick={() => { window.location.href = '/dashboard'; }}
              variant="blue"
              style={{
                padding: '18px 44px',
                fontSize: 20,
                fontFamily: 'var(--font-fraunces), Georgia, serif',
                fontVariationSettings: "'SOFT' 100, 'WONK' 0, 'opsz' 144",
                fontWeight: 900,
                letterSpacing: '-0.01em',
              }}
            >
              {t('Try It Free — No Card Needed')} →
            </TraceBorderCta>
            <p className="font-mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(255,248,234,0.3)', marginTop: 14 }}>
              {t('takes about 60 seconds')}
            </p>
          </div>
          </Reveal>

          {/* ── Trust Strip ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, padding: '0 0 64px', ...(isMobile ? { gridTemplateColumns: '1fr' } : {}) }}>
            {[
              { title: 'Your photo stays private', body: 'We never sell or share your scan. Delete your data anytime from settings.' },
              { title: 'AI trained on real cuts', body: '3D facial mesh and strand-level simulation built from real barbershop styles.' },
              { title: 'Free to try, no risk', body: 'Your first previews are completely free. Pay only if you love the results.' },
            ].map((item, i) => (
              <Reveal key={i} delay={i * 100}>
                <div className="trust-card">
                  <div className="font-sans" style={{ fontSize: 15, fontWeight: 600, color: 'var(--cream)', marginBottom: 8 }}>{t(item.title)}</div>
                  <div className="font-sans" style={{ fontSize: 13, color: 'rgba(255,248,234,0.5)', lineHeight: 1.6 }}>{t(item.body)}</div>
                </div>
              </Reveal>
            ))}
          </div>

          {/* ── Footer strip ── */}
          <div style={{ borderTop: '1px solid rgba(255,248,234,0.12)', padding: '28px 0 40px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {/* Instagram */}
              <a
                href="https://www.instagram.com/tryshapeup/"
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
                { label: 'Contact', href: '/contact' },
              ].map(({ label, href }, i) => (
                <span key={label}>
                  <a
                    href={href}
                    className="font-mono"
                    style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,248,234,0.3)', textDecoration: 'none', transition: 'color 140ms ease' }}
                    onMouseEnter={e => ((e.target as HTMLElement).style.color = 'rgba(255,248,234,0.6)')}
                    onMouseLeave={e => ((e.target as HTMLElement).style.color = 'rgba(255,248,234,0.3)')}
                  >
                    {t(label)}
                  </a>
                  {i < 4 && <span className="font-mono" style={{ fontSize: 10, color: 'rgba(255,248,234,0.15)', margin: '0 14px' }}>·</span>}
                </span>
              ))}
            </div>
          </div>

        </div>
      </div>

      {pendingAction && createPortal(
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 60,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: authVisible && !authClosing ? 'rgba(10,8,6,0.92)' : 'rgba(10,8,6,0)',
            transition: 'background 320ms ease',
          }}
          onClick={dismissAuth}
        >
          <button
            onClick={dismissAuth}
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
                {pendingAction.type === 'free' ? t('create your account') : t('sign in to purchase')}
              </p>
              <h2 className="auth-modal-heading" style={{
                fontFamily: 'var(--font-fraunces), Georgia, serif',
                fontSize: 'clamp(2rem, 4vw, 2.8rem)', fontWeight: 900,
                color: 'var(--cream)', letterSpacing: '-0.03em', lineHeight: 0.95, margin: 0,
              }}>
                {pendingAction.type === 'free' ? t('Start exploring.') : t('One step away.')}
              </h2>
            </div>
            <SignUpWidget
              onEnter={handleAuthDone}
              large
              onBeforeGoogleRedirect={() => {
                if (pendingAction?.type === 'paid') {
                  sessionStorage.setItem('pendingPlanId', pendingAction.planId);
                }
              }}
            />
          </div>
        </div>,
        document.body
      )}
    </main>
  );
}

export default LandingPage;
