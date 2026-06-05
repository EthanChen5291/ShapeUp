'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

// ─── Timing ────────────────────────────────────────────────────────────────
const BPM = 94;
const BEAT_MS = 60000 / BPM; // ≈638.30ms
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const SLEEP_FRAME_MS = 1000 / 3; // 333.33ms at 3fps
const SLEEP_SEQ = [0, 1, 2, 3, 2, 1]; // ping-pong breath cycle

// ─── Assets ────────────────────────────────────────────────────────────────
const SCENES = Array.from({ length: 9 }, (_, i) => `/scene/scene_${i}.png`);
const SLEEP_FRAMES = Array.from({ length: 4 }, (_, i) => `/sleep/sleep_${i}.png`);
const GRAIN = '/textures/paper_grain.png';
const AUDIO = '/audio/golden_hour_orchestral.mp3';

// ─── Dust mote config (negative delays = stagger across viewport on load) ──
const MOTES = [
  { size: 6, x: 15, vDur: 72, hDur: 9,  delay: -10 },
  { size: 4, x: 42, vDur: 85, hDur: 13, delay: -25 },
  { size: 7, x: 68, vDur: 61, hDur: 11, delay: -40 },
  { size: 5, x: 80, vDur: 78, hDur: 8,  delay: -55 },
  { size: 4, x: 28, vDur: 90, hDur: 14, delay: -5  },
];

type AppState = 'idle' | 'intro' | 'main';

export default function MomPage() {
  const [appState, setAppState] = useState<AppState>('idle');
  const [loaded, setLoaded] = useState(false);

  // DOM refs — all animation goes through these, not React state
  const rootRef      = useRef<HTMLDivElement>(null);
  const fromRef      = useRef<HTMLDivElement>(null);
  const forRef       = useRef<HTMLDivElement>(null);
  const sceneRefs    = useRef<(HTMLImageElement | null)[]>(Array(9).fill(null));
  const sleepLayer   = useRef<HTMLDivElement>(null);
  const sleepImg     = useRef<HTMLImageElement>(null);
  const dustRef      = useRef<HTMLDivElement>(null);
  const barTop       = useRef<HTMLDivElement>(null);
  const barBot       = useRef<HTMLDivElement>(null);
  const audioRef     = useRef<HTMLAudioElement | null>(null);
  const timers       = useRef<ReturnType<typeof setTimeout>[]>([]);
  const sleepTimer   = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Preload all assets before enabling START ─────────────────────────
  useEffect(() => {
    const loadImg = (src: string) =>
      new Promise<void>((done) => {
        const img = new Image();
        img.onload  = () => done();
        img.onerror = () => done(); // don't block on missing files during dev
        img.src = src;
        if (img.complete) done();
      });

    const audio = new Audio();
    audio.preload = 'auto';
    audioRef.current = audio;

    const loadAudio = new Promise<void>((done) => {
      audio.addEventListener('canplaythrough', () => done(), { once: true });
      audio.onerror = () => done();
      audio.src = AUDIO;
    });

    Promise.all([
      ...SCENES.map(loadImg),
      ...SLEEP_FRAMES.map(loadImg),
      loadImg(GRAIN),
      loadAudio,
    ]).then(() => setLoaded(true));

    return () => { audio.pause(); };
  }, []);

  // ─── Cleanup timers on unmount ────────────────────────────────────────
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    if (sleepTimer.current) clearInterval(sleepTimer.current);
  }, []);

  // ─── Start handler ────────────────────────────────────────────────────
  function handleStart() {
    if (!loaded || !audioRef.current) return;

    const audio = audioRef.current;
    audio.volume = 0.85;
    audio.play().catch(() => {});
    const t0 = performance.now();

    setAppState('intro');
    if (rootRef.current) rootRef.current.style.cursor = 'none';

    // Fade helper — sets transition + target opacity directly on the element
    function fade(el: HTMLElement | null, to: number, ms: number) {
      if (!el) return;
      el.style.transition = `opacity ${ms}ms ${EASE}`;
      el.style.opacity    = String(to);
    }

    // Schedule relative to t0 — each call reads performance.now() fresh
    // so no drift accumulates between events
    function at(beat: number, cb: () => void, msOffset = 0) {
      const delay = t0 + beat * BEAT_MS + msOffset - performance.now();
      const id = setTimeout(cb, Math.max(0, delay));
      timers.current.push(id);
    }

    // ── Dedication text ──────────────────────────────────────────────────
    // Beat 3  → From Ethan fades in  (1-beat ease)
    at(2, () => fade(fromRef.current, 1, BEAT_MS));
    // Beat 5  → From Ethan fades out
    at(4, () => fade(fromRef.current, 0, BEAT_MS));
    // Beat 7  → For mom fades in
    at(6, () => fade(forRef.current,  1, BEAT_MS));
    // Beat 9  → For mom fades out
    at(8, () => fade(forRef.current,  0, BEAT_MS));

    // ── Scene 0 — establishing shot (2-beat hold) ────────────────────────
    // Beat 10: slower 400ms entrance so the eye settles on the room
    at(9, () => fade(sceneRefs.current[0], 1, 400));

    // scene_0 → scene_1 uses 250ms (slightly longer than subsequent cuts)
    at(11, () => {
      fade(sceneRefs.current[0], 0, 250);
      fade(sceneRefs.current[1], 1, 250);
    }, -250);

    // ── Scenes 1–7 → N+1 crossfades (200ms) ─────────────────────────────
    // scene_N holds 1 beat; crossfade starts 200ms before the next beat
    // n=1 → at(12, -200), n=2 → at(13, -200), … n=7 → at(18, -200)
    for (let n = 1; n <= 7; n++) {
      const i = n; // capture for closure
      at(11 + n, () => {
        fade(sceneRefs.current[i],     0, 200);
        fade(sceneRefs.current[i + 1], 1, 200);
      }, -200);
    }

    // ── Scene 8 → sleep loop (700ms crossfade completes on beat 20) ──────
    at(19, () => {
      fade(sceneRefs.current[8], 0, 700);
      fade(sleepLayer.current,   1, 700);
      startSleepLoop();
    }, -700);

    // ── Beat 20 — transition to main state ───────────────────────────────
    at(19, () => {
      setAppState('main');

      // Retract letterboxing bars (scaleY to 0 from their respective edges)
      if (barTop.current) {
        barTop.current.style.transformOrigin = 'top';
        barTop.current.style.transition      = `transform 800ms ${EASE}`;
        barTop.current.style.transform       = 'scaleY(0)';
      }
      if (barBot.current) {
        barBot.current.style.transformOrigin = 'bottom';
        barBot.current.style.transition      = `transform 800ms ${EASE}`;
        barBot.current.style.transform       = 'scaleY(0)';
      }

      // Restore cursor, fade dust motes in
      if (rootRef.current) rootRef.current.style.cursor = 'default';
      fade(dustRef.current, 1, 400);
    });
  }

  // ─── Sleep loop — ping-pong at 3fps ──────────────────────────────────
  function startSleepLoop() {
    if (sleepImg.current) sleepImg.current.src = SLEEP_FRAMES[0];
    let cursor = 0;
    sleepTimer.current = setInterval(() => {
      cursor++;
      const fi = SLEEP_SEQ[cursor % SLEEP_SEQ.length];
      if (sleepImg.current) sleepImg.current.src = SLEEP_FRAMES[fi];
    }, SLEEP_FRAME_MS);
  }

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <>
      {/* Dust mote keyframes — scoped to this page */}
      <style>{`
        @keyframes dust-v {
          from { transform: translateY(0); }
          to   { transform: translateY(110vh); }
        }
        @keyframes dust-h {
          0%, 100% { transform: translateX(-20px); }
          50%      { transform: translateX(20px); }
        }
      `}</style>

      <div
        ref={rootRef}
        style={{
          position:   'fixed',
          inset:      0,
          background: '#000',
          overflow:   'hidden',
          userSelect: 'none',
        }}
      >
        {/* ── Scene images (all stacked, opacity-animated) ── */}
        {SCENES.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={src}
            ref={(el) => { sceneRefs.current[i] = el; }}
            src={src}
            alt=""
            draggable={false}
            style={{
              position:   'absolute',
              inset:      0,
              width:      '100%',
              height:     '100%',
              objectFit:  'cover',
              opacity:    0,
            }}
          />
        ))}

        {/* ── Sleep layer ── */}
        <div ref={sleepLayer} style={{ position: 'absolute', inset: 0, opacity: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={sleepImg}
            src={SLEEP_FRAMES[0]}
            alt=""
            draggable={false}
            style={{
              position:  'absolute',
              inset:     0,
              width:     '100%',
              height:    '100%',
              objectFit: 'cover',
            }}
          />

          {/* Dust motes — only visible after sleep loop begins */}
          <div
            ref={dustRef}
            style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none' }}
          >
            {MOTES.map((m, i) => (
              // Outer div handles vertical drift; inner div handles horizontal sway
              // Separate transforms on parent/child avoid transform-conflict
              <div
                key={i}
                style={{
                  position:  'absolute',
                  top:       0,
                  left:      `${m.x}%`,
                  animation: `dust-v ${m.vDur}s linear ${m.delay}s infinite`,
                }}
              >
                <div
                  style={{
                    width:        m.size,
                    height:       m.size,
                    borderRadius: '50%',
                    background:   'radial-gradient(circle, rgba(255,250,240,0.9) 0%, rgba(255,250,240,0) 100%)',
                    opacity:      0.5,
                    animation:    `dust-h ${m.hDur}s ease-in-out ${m.delay}s infinite`,
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* ── Dedication text layers ── */}
        <div ref={fromRef} style={textLayerStyle}>
          <span style={dedicationStyle}>From Ethan</span>
        </div>
        <div ref={forRef} style={textLayerStyle}>
          <span style={dedicationStyle}>For mom</span>
        </div>

        {/* ── Letterboxing bars ── */}
        <div
          ref={barTop}
          style={{
            position:   'fixed',
            top:        0,
            left:       0,
            right:      0,
            height:     '8vh',
            background: '#000',
            zIndex:     10,
          }}
        />
        <div
          ref={barBot}
          style={{
            position:   'fixed',
            bottom:     0,
            left:       0,
            right:      0,
            height:     '8vh',
            background: '#000',
            zIndex:     10,
          }}
        />

        {/* ── Paper grain overlay (tileable, multiply blend, always on) ── */}
        <div
          style={{
            position:            'fixed',
            inset:               0,
            backgroundImage:     `url(${GRAIN})`,
            backgroundRepeat:    'repeat',
            backgroundSize:      '512px 512px',
            mixBlendMode:        'multiply',
            opacity:             0.18,
            pointerEvents:       'none',
            zIndex:              20,
          }}
        />

        {/* ── START overlay — only in idle state ── */}
        {appState === 'idle' && (
          <div
            style={{
              position:        'absolute',
              inset:           0,
              zIndex:          30,
              display:         'flex',
              flexDirection:   'column',
              alignItems:      'center',
              justifyContent:  'center',
              gap:             24,
            }}
          >
            <button
              onClick={handleStart}
              disabled={!loaded}
              style={buttonStyle(loaded)}
            >
              {loaded ? 'START' : 'LOADING…'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Style objects ──────────────────────────────────────────────────────────

const textLayerStyle: CSSProperties = {
  position:        'absolute',
  inset:           0,
  display:         'flex',
  alignItems:      'center',
  justifyContent:  'center',
  opacity:         0,
  pointerEvents:   'none',
};

const dedicationStyle: CSSProperties = {
  fontFamily:    'var(--font-cormorant), "Cormorant Garamond", Georgia, serif',
  fontWeight:    300,
  fontStyle:     'italic',
  fontSize:      'clamp(36px, 5.5vw, 64px)',
  letterSpacing: '0.02em',
  color:         '#f5f0e8',
};

function buttonStyle(active: boolean): CSSProperties {
  return {
    background:     'transparent',
    color:          active ? '#f5f0e8' : '#555',
    border:         `1.5px solid ${active ? '#f5f0e8' : '#444'}`,
    padding:        '14px 52px',
    fontFamily:     'var(--font-dmsans), system-ui, sans-serif',
    fontSize:       '11px',
    fontWeight:     700,
    letterSpacing:  '0.3em',
    textTransform:  'uppercase',
    cursor:         active ? 'pointer' : 'not-allowed',
    outline:        'none',
    transition:     'color 300ms ease, border-color 300ms ease',
  };
}
