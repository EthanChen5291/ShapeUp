'use client';

// ============================================================
// BarberLandingPage — the public `/` marketing page.
//
// Campaign concept: "THE CARD THAT WORKS THE CHAIR." The barber card is
// treated as a physical object with a life cycle — pressed in the studio
// (hero), taped to the mirror (client journey), made the barber's own
// (customization), passed around town (distribution), and read back as a
// till receipt (analytics).
//
// Instead of embedded screen recordings, the product demos are scripted
// motion compositions built from the real product's markup and palette
// (studio labels, /b/<slug> card layout, night/heritage/sage themes, the
// real insight metric names). Each scene is a step timeline driven by
// useScenePlayer: it advances on a fixed beat sheet while on screen,
// freezes off screen, and collapses to its finished frame under
// prefers-reduced-motion. All tweening is CSS on [data-step] state, so the
// text stays vector-crisp at any DPI and the page ships no multi-megabyte
// video for the UI itself. Real footage appears in two places, both actual
// product output: the journey scene's try-on (landing_face1) and the
// try-on playground (landing_face2 — one client, eight requests, tappable).
// Both are lazy-armed near the viewport and paused when off screen.
//
// Truth rules baked in: metric names match the studio's Insights panel,
// demo numbers are labeled as seeded demonstration data, and the
// testimonial wall ships as an explicitly reserved placeholder — no
// invented barbers, quotes, or results.
// ============================================================

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

/* ─────────────────────────── icons (one stroke family, never emoji) ─── */

const iconProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function ScissorsIcon() {
  return <svg {...iconProps}><circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="m8.7 8.3 10.8 7.2M8.7 15.7 19.5 8.5"/></svg>;
}
function CalendarIcon() {
  return <svg {...iconProps}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M9 16l2 2 4-4"/></svg>;
}
function QrIcon() {
  return <svg {...iconProps}><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3zM18 14h3M14 19v2"/></svg>;
}
function LinkIcon() {
  return <svg {...iconProps}><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/></svg>;
}
function ArrowIcon() {
  return <svg {...iconProps} width={18} height={18}><path d="M5 12h14M13 6l6 6-6 6"/></svg>;
}
function CheckIcon() {
  return <svg {...iconProps} width={16} height={16}><path d="M4 12.5 9.5 18 20 6.5"/></svg>;
}
function InstagramIcon() {
  return <svg {...iconProps}><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/></svg>;
}
function MessageIcon() {
  return <svg {...iconProps}><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3h.5a8.5 8.5 0 0 1 8 8v.5z"/></svg>;
}
function WalletIcon() {
  return <svg {...iconProps}><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 9h18M16 14h2"/></svg>;
}
function GlobeIcon() {
  return <svg {...iconProps}><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/></svg>;
}
function PinIcon() {
  return <svg {...iconProps} width={14} height={14}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>;
}

/** Decorative QR glyph — finder squares + noise, reads as "QR" at demo scale. */
function QrGlyph({ className }: { className?: string }) {
  const cells = [
    [8, 1], [10, 1], [8, 3], [11, 3], [9, 4], [12, 4], [8, 6], [10, 6], [12, 6],
    [1, 8], [3, 8], [5, 8], [8, 8], [10, 8], [13, 8], [2, 10], [4, 10], [7, 10],
    [9, 9], [11, 10], [13, 10], [1, 12], [5, 12], [8, 12], [10, 12], [12, 12],
    [8, 13], [11, 13], [13, 13], [9, 11], [12, 9], [4, 9], [6, 11], [6, 13],
  ];
  return (
    <svg className={className} viewBox="0 0 15 15" aria-hidden focusable="false">
      {[[0, 0], [8.5, 0], [0, 8.5]].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width="4.5" height="4.5" fill="none" stroke="currentColor" strokeWidth="1" />
          <rect x={x + 1.5} y={y + 1.5} width="1.5" height="1.5" fill="currentColor" />
        </g>
      ))}
      {cells.map(([x, y]) => (
        <rect key={`${x}.${y}`} x={x === 8.5 ? 8.5 : x - 0.5} y={y - 0.5} width="1" height="1" fill="currentColor" />
      ))}
    </svg>
  );
}

/* ─────────────────────────── motion plumbing ─────────────────────────── */

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

function useInView<T extends HTMLElement>(threshold = 0.3, rootMargin = '0px') {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setInView(entries.some((entry) => entry.isIntersecting)),
      { threshold, rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);
  return { ref, inView };
}

/**
 * Advances `step` through a beat sheet while the scene is on screen, freezes
 * when scrolled away, restarts after a beat on the last frame, and pins the
 * finished frame for reduced-motion users.
 */
function useScenePlayer(durations: readonly number[], restartDelay = 1100) {
  const reduced = usePrefersReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>(0.3, '0px 0px -10% 0px');
  const [step, setStep] = useState(0);
  const last = durations.length - 1;

  useEffect(() => {
    if (reduced) {
      setStep(last);
      return;
    }
    if (!inView) return;
    const wait = step === last ? durations[last] + restartDelay : durations[step];
    const timer = setTimeout(() => setStep((s) => (s >= last ? 0 : s + 1)), wait);
    return () => clearTimeout(timer);
  }, [reduced, inView, step, durations, last, restartDelay]);

  return { ref, step, inView, reduced };
}

/** Eased count-up for the analytics receipt; snaps to target for reduced motion. */
function useCountUp(target: number, active: boolean, reduced: boolean, duration = 1400): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) {
      setValue(0);
      return;
    }
    if (reduced) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, reduced, duration]);
  return value;
}

/** jsdom's media element has no real play(); browsers return a promise to swallow. */
function safePlay(video: HTMLVideoElement) {
  try {
    const result = video.play() as Promise<void> | undefined;
    result?.catch?.(() => {});
  } catch {
    /* non-autoplay environment */
  }
}

/**
 * Real try-on footage (actual product output). `armed` defers the network
 * request until the scene approaches the viewport; `active` decides which of
 * the crossfaded layers is playing. Reduced motion gets the still poster.
 */
function TryOnVideo({
  src,
  poster,
  label,
  armed,
  active,
  reduced,
}: {
  src: string;
  poster: string;
  label: string;
  armed: boolean;
  active: boolean;
  reduced: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (armed && active) safePlay(video);
    else video.pause?.();
  }, [armed, active]);

  if (reduced) {
    return <img className={`bl-tryon-media${active ? ' is-active' : ''}`} src={poster} alt={label} />;
  }
  return (
    <video
      ref={videoRef}
      className={`bl-tryon-media${active ? ' is-active' : ''}`}
      src={armed ? src : undefined}
      poster={poster}
      muted
      loop
      playsInline
      preload="none"
      aria-label={label}
    />
  );
}

/* ─────────────────────────── shared demo fixtures ────────────────────── */

const DEMO = {
  url: 'shapeup.cc/b/marcus',
  name: 'Marcus Rivera',
  shop: 'FADE THEORY',
  meta: 'Oakland, CA · Tue–Sat 10–7',
  services: [
    ['Signature cut', '$45'],
    ['Cut + beard', '$65'],
    ['Kids (12 & under)', '$30'],
  ],
  cuts: [
    ['blowout-taper', 'Blowout taper'],
    ['wolf-cut-light-layers', 'Wolf cut'],
    ['textured-crop-skin-fade', 'Textured crop'],
  ],
} as const;

const thumb = (slug: string) => `/hair-previews/thumb/${slug}.jpg`;

/**
 * The phone-framed barber card every scene reuses — same hierarchy as the
 * real /b/<slug> page (cover → identity → services → book → links → styles),
 * themed with the card's real night/heritage palettes. Visibility flags let
 * scene timelines build it up piece by piece.
 */
function CardPhone({
  theme = 'night',
  showIdentity = true,
  showServices = true,
  showBook = true,
  showLinks = true,
  showCuts = true,
  ghost = false,
  className = '',
}: {
  theme?: 'night' | 'heritage';
  showIdentity?: boolean;
  showServices?: boolean;
  showBook?: boolean;
  showLinks?: boolean;
  showCuts?: boolean;
  ghost?: boolean;
  className?: string;
}) {
  return (
    <div className={`bl-phone is-${theme}${ghost ? ' is-ghost' : ''} ${className}`}>
      <div className="bl-phone-screen">
        <div className="bl-phone-url font-mono">{DEMO.url}</div>
        <div className="bl-card-cover" />
        <div className={`bl-card-id${showIdentity ? ' is-on' : ''}`}>
          <span className="bl-card-avatar font-display" aria-hidden>MR</span>
          <span className="bl-card-kicker font-mono">{showIdentity ? DEMO.shop : 'YOUR SHOP'}</span>
          <strong className="font-display">{showIdentity ? DEMO.name : 'Your name'}</strong>
          <small>{showIdentity ? DEMO.meta : 'City · Hours'}</small>
        </div>
        <ul className={`bl-card-services${showServices ? ' is-on' : ''}`}>
          {DEMO.services.slice(0, 2).map(([name, price], i) => (
            <li key={name} style={{ transitionDelay: showServices ? `${i * 140}ms` : '0ms' }}>
              <span>{name}</span><b className="font-mono">{price}</b>
            </li>
          ))}
        </ul>
        <div className={`bl-card-book${showBook ? ' is-on' : ''}`}>Book with Marcus <ArrowIcon /></div>
        <div className={`bl-card-links${showLinks ? ' is-on' : ''}`} aria-hidden>
          <span><InstagramIcon /></span>
          <span><MessageIcon /></span>
          <span><PinIcon /></span>
        </div>
        <div className={`bl-card-cuts${showCuts ? ' is-on' : ''}`}>
          <span className="font-mono">MARCUS RECOMMENDS — TAP TO TRY ON</span>
          <div>
            {DEMO.cuts.map(([slug, label], i) => (
              <img key={slug} src={thumb(slug)} alt={label} width={54} height={54} loading="lazy" style={{ transitionDelay: showCuts ? `${i * 120}ms` : '0ms' }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════ SCENE 1 — hero builder loop ═══════════════ */
/* Beat sheet (~14s): claim link → identity → services → theme → cuts →
   publish → hold finished card + QR plate. */

const BUILDER_BEATS = [1500, 1900, 2100, 2000, 1900, 2100, 2800] as const;

function BuilderScene() {
  const { ref, step } = useScenePlayer(BUILDER_BEATS);
  const on = (n: number) => step >= n;

  return (
    <div
      ref={ref}
      className="bl-scene bl-builder"
      data-step={step}
      role="img"
      aria-label="Silent product demo: a barber claims shapeup.cc/b/marcus, types their name and shop, adds priced services, picks the Heritage card style, selects recommended cuts, and publishes — the live card preview updates at every step and finishes with the card's QR code and URL."
    >
      <div aria-hidden className="bl-scene-inner">
        <div className="bl-studio">
          <div className="bl-studio-tabs font-sans">
            <span className="is-active">Design</span><span>Share</span><span>Insights</span>
          </div>
          <div className={`bl-field${on(0) ? ' is-on' : ''}`}>
            <span className="bl-field-label font-mono">YOUR LINK</span>
            <span className="bl-field-input font-mono"><i className="bl-type is-mono">{DEMO.url}</i></span>
          </div>
          <div className={`bl-field${on(1) ? ' is-on' : ''}`}>
            <span className="bl-field-label font-mono">NAME</span>
            <span className="bl-field-input"><i className="bl-type">{DEMO.name}</i></span>
          </div>
          <div className={`bl-field${on(1) ? ' is-on' : ''}`}>
            <span className="bl-field-label font-mono">SHOP</span>
            <span className="bl-field-input"><i className="bl-type">Fade Theory</i></span>
          </div>
          <div className={`bl-field${on(2) ? ' is-on' : ''}`}>
            <span className="bl-field-label font-mono">SERVICES &amp; PRICING</span>
            {DEMO.services.slice(0, 2).map(([name, price], i) => (
              <span key={name} className="bl-field-row" style={{ transitionDelay: on(2) ? `${i * 200}ms` : '0ms' }}>
                <span>{name}</span><b className="font-mono">{price}</b>
              </span>
            ))}
          </div>
          <div className={`bl-field${on(3) ? ' is-on' : ''}`}>
            <span className="bl-field-label font-mono">CARD STYLE</span>
            <span className="bl-theme-chips">
              <i className={`is-night${on(3) ? '' : ' is-picked'}`}>Night</i>
              <i className={`is-heritage${on(3) ? ' is-picked' : ''}`}>Heritage</i>
              <i className="is-sage">Sage</i>
            </span>
          </div>
          <div className={`bl-field${on(4) ? ' is-on' : ''}`}>
            <span className="bl-field-label font-mono">RECOMMENDED CUTS</span>
            <span className="bl-cut-picks">
              {DEMO.cuts.map(([slug, label]) => (
                <img key={slug} src={thumb(slug)} alt={label} width={38} height={38} loading="lazy" />
              ))}
            </span>
          </div>
          <div className={`bl-field bl-publish${on(5) ? ' is-on' : ''}`}>
            <span className={`bl-toggle${on(5) ? ' is-live' : ''}`}><i /></span>
            <span className="font-sans">Card is public</span>
          </div>
        </div>

        <CardPhone
          theme={on(3) ? 'heritage' : 'night'}
          showIdentity={on(1)}
          showServices={on(2)}
          showBook={on(2)}
          showLinks={on(4)}
          showCuts={on(4)}
          className="bl-builder-phone"
        />

        <div className={`bl-live-plate${on(5) ? ' is-on' : ''}`}>
          <QrGlyph className="bl-live-qr" />
          <div>
            <span className="bl-live-stamp font-mono">LIVE</span>
            <b className="font-mono">{DEMO.url}</b>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════ SCENE 2 — client journey ══════════════════ */
/* Mirror QR → card opens → scroll to recommended cuts → try-on (real
   footage swap) → book → confirmed. */

const JOURNEY_BEATS = [1600, 1700, 1800, 2600, 2200, 2400, 2000] as const;

function JourneyScene() {
  const { ref, step, inView, reduced } = useScenePlayer(JOURNEY_BEATS);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (inView) setArmed(true);
  }, [inView]);
  const on = (n: number) => step >= n;
  const phase = step < 3 ? 'card' : step < 5 ? 'tryon' : 'booking';

  return (
    <div
      ref={ref}
      className="bl-scene bl-journey"
      data-step={step}
      role="img"
      aria-label="Silent product demo of the client journey: a client scans the QR card taped to the shop mirror, the barber card opens on their phone, they scroll to the recommended cuts, tap the wolf cut, see it rendered on their own head with the virtual try-on, then book Thursday 3:30 and the request lands with the barber."
    >
      <div aria-hidden className="bl-scene-inner">
        <div className={`bl-mirror-card${on(1) ? ' is-scanned' : ''}`}>
          <span className="bl-tape" />
          <span className="font-mono">SCAN FOR MY CARD</span>
          <QrGlyph className="bl-mirror-qr" />
          <b className="font-display">Fade Theory</b>
          <small className="font-mono">{DEMO.url}</small>
          <span className="bl-scan-ring" />
        </div>

        <div className={`bl-journey-arrow${on(1) ? ' is-on' : ''}`}><ArrowIcon /></div>

        <div className={`bl-phone is-night bl-journey-phone${on(1) ? ' is-lit' : ''}`}>
          <div className="bl-phone-screen" data-phase={phase}>
            <div className="bl-phone-url font-mono">{DEMO.url}</div>

            {/* layer 1 — the card, scrolled to the cuts row on beat 2 */}
            <div className={`bl-journey-layer is-card${phase === 'card' ? ' is-active' : ''}${on(2) ? ' is-scrolled' : ''}`}>
              <div className="bl-card-cover" />
              <div className="bl-card-id is-on">
                <span className="bl-card-avatar font-display">MR</span>
                <span className="bl-card-kicker font-mono">{DEMO.shop}</span>
                <strong className="font-display">{DEMO.name}</strong>
                <small>{DEMO.meta}</small>
              </div>
              <ul className="bl-card-services is-on">
                {DEMO.services.slice(0, 2).map(([name, price]) => (
                  <li key={name}><span>{name}</span><b className="font-mono">{price}</b></li>
                ))}
              </ul>
              <div className="bl-card-cuts is-on">
                <span className="font-mono">MARCUS RECOMMENDS — TAP TO TRY ON</span>
                <div>
                  {DEMO.cuts.map(([slug, label]) => (
                    <img key={slug} src={thumb(slug)} alt={label} width={54} height={54} loading="lazy" className={slug === 'wolf-cut-light-layers' && on(2) ? 'is-target' : ''} />
                  ))}
                </div>
              </div>
            </div>

            {/* layer 2 — virtual try-on with real generated footage */}
            <div className={`bl-journey-layer is-tryon${phase === 'tryon' ? ' is-active' : ''}`}>
              <span className="bl-tryon-kicker font-mono">VIRTUAL TRY-ON</span>
              <div className="bl-tryon-stage">
                <TryOnVideo src="/landing_face1/face1a.mp4" poster="/landing_face1/face1a_poster.jpg" label="Client's own hair before the try-on" armed={armed} active={phase === 'tryon' && !on(4)} reduced={reduced} />
                <TryOnVideo src="/landing_face1/face1b.mp4" poster="/landing_face1/face1b_poster.jpg" label="The wolf cut rendered on the client's head" armed={armed} active={on(4)} reduced={reduced} />
                <span className={`bl-tryon-tag font-mono${on(4) ? ' is-on' : ''}`}>WOLF CUT</span>
              </div>
              <div className={`bl-tryon-actions${on(4) ? ' is-on' : ''}`}>
                <span className="is-primary">Book this cut</span>
                <span>Send to Marcus</span>
              </div>
            </div>

            {/* layer 3 — booking confirmation */}
            <div className={`bl-journey-layer is-booking${phase === 'booking' ? ' is-active' : ''}`}>
              <span className="bl-tryon-kicker font-mono">BOOK WITH MARCUS</span>
              <div className="bl-slot-grid">
                {['Thu 2:45', 'Thu 3:30', 'Fri 11:00'].map((slot) => (
                  <span key={slot} className={slot === 'Thu 3:30' ? 'is-picked font-mono' : 'font-mono'}>{slot}</span>
                ))}
              </div>
              <div className={`bl-booking-confirm${on(6) ? ' is-on' : ''}`}>
                <span className="bl-confirm-check"><CheckIcon /></span>
                <div>
                  <b className="font-display">Thursday, 3:30 PM</b>
                  <small>Wolf cut · preview sent to Marcus</small>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════ SCENE 2b — try-on playground ══════════════ */
/* The old landing page's best moment, rebuilt in the card's language: one
   client, eight plain-English requests, every result a real ShapeUp render
   (landing_face2). An idle clip plays until the first request; requests
   auto-fire on a slow cycle until the visitor taps one, then it's theirs.
   All nine videos stay src-less until the section approaches the viewport;
   reduced motion swaps the stage for the finished-frame posters. */

const FACE2_STYLES = [
  ['face2a', 'Take 6 inches off'],
  ['face2b', 'Wavy dirty blonde'],
  ['face2c', 'Go full blonde'],
  ['face2d', 'Messy high bun'],
  ['face2e', 'Twin buns, tied up'],
  ['face2f', 'Wolf cut + red streaks'],
  ['face2g', 'Go full pink'],
  ['face2h', 'Two pigtails, please'],
] as const;

const face2Src = (id: string) => `/landing_face2/${id}.mp4`;
const face2Poster = (id: string) => `/landing_face2/${id}_poster.jpg`;

function TryOnPlayground() {
  const reduced = usePrefersReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>(0.15, '400px 0px 400px 0px');
  const [armed, setArmed] = useState(false);
  const [started, setStarted] = useState(false);
  const [active, setActive] = useState(0);
  const [interacted, setInteracted] = useState(false);
  const idleRef = useRef<HTMLVideoElement | null>(null);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);

  useEffect(() => {
    if (inView) setArmed(true);
  }, [inView]);

  // Reduced motion skips the idle clip and pins the first finished render.
  useEffect(() => {
    if (reduced) setStarted(true);
  }, [reduced]);

  // Exactly one layer plays: the idle clip before the first request, then the
  // active render. Everything pauses off screen.
  useEffect(() => {
    if (reduced || !armed) return;
    const idle = idleRef.current;
    const layers = videoRefs.current;
    if (!inView) {
      idle?.pause?.();
      layers.forEach((video) => video?.pause?.());
      return;
    }
    if (!started) {
      if (idle) safePlay(idle);
      return;
    }
    idle?.pause?.();
    layers.forEach((video, i) => {
      if (!video) return;
      if (i === active) {
        try { video.currentTime = 0; } catch { /* unbuffered */ }
        safePlay(video);
      } else {
        video.pause?.();
      }
    });
  }, [reduced, armed, inView, started, active]);

  // Requests fire themselves on a slow cycle until the visitor taps one.
  useEffect(() => {
    if (reduced || !inView || interacted) return;
    const timer = setTimeout(() => {
      if (!started) setStarted(true);
      else setActive((current) => (current + 1) % FACE2_STYLES.length);
    }, started ? 3600 : 2200);
    return () => clearTimeout(timer);
  }, [reduced, inView, interacted, started, active]);

  const pick = (i: number) => {
    setInteracted(true);
    setStarted(true);
    setActive(i);
  };

  const [activeId, activeLabel] = FACE2_STYLES[active];

  return (
    <div ref={ref} className="bl-playground">
      <div className="bl-play-requests" role="group" aria-label="Try a request on the demo client">
        {FACE2_STYLES.map(([id, label], i) => (
          <button
            key={id}
            type="button"
            className={`bl-play-chip${started && i === active ? ' is-active' : ''}`}
            aria-pressed={started && i === active}
            onClick={() => pick(i)}
          >
            {label}
          </button>
        ))}
        <p className="bl-play-hint font-mono">TAP A REQUEST — OR WATCH THEM FIRE</p>
      </div>

      <figure className="bl-play-stage">
        <span className="bl-tape" aria-hidden />
        {reduced ? (
          <img className="bl-play-media is-active" src={face2Poster(activeId)} alt={`Real ShapeUp render: ${activeLabel.toLowerCase()} on the demo client`} />
        ) : (
          <>
            <video
              ref={idleRef}
              className={`bl-play-media${started ? '' : ' is-active'}`}
              src={armed ? face2Src('face2') : undefined}
              poster={face2Poster('face2')}
              muted
              loop
              playsInline
              preload="none"
              aria-label="The demo client's own hair, before any request"
            />
            {FACE2_STYLES.map(([id, label], i) => (
              <video
                key={id}
                ref={(el) => { videoRefs.current[i] = el; }}
                className={`bl-play-media${started && i === active ? ' is-active' : ''}`}
                src={armed ? face2Src(id) : undefined}
                poster={face2Poster(id)}
                muted
                loop
                playsInline
                preload={armed ? 'auto' : 'none'}
                aria-label={`Real ShapeUp render: ${label.toLowerCase()} on the demo client`}
              />
            ))}
          </>
        )}
        <figcaption className={`bl-play-bubble${started ? ' is-on' : ''}`} aria-live="polite">
          <span className="font-sans">{started ? `“${activeLabel}”` : 'Waiting on a request…'}</span>
        </figcaption>
        <span className="bl-play-tag font-mono">REAL SHAPEUP RENDERS · ONE CLIENT, EIGHT REQUESTS</span>
      </figure>
    </div>
  );
}

/* ═══════════════════════════ SCENE 3 — make it yours ═══════════════════ */

const CUSTOMIZE_BEATS = [1500, 1300, 1300, 1300, 1300, 1400, 2600] as const;

const CUSTOMIZE_ITEMS = [
  'Profile & cover photo',
  'Card style — Night, Heritage, Sage',
  'Services & pricing',
  'Links & payments',
  'Booking schedule',
  'Recommended cuts',
] as const;

function CustomizeScene() {
  const { ref, step } = useScenePlayer(CUSTOMIZE_BEATS);
  const on = (n: number) => step >= n;

  return (
    <div
      ref={ref}
      className="bl-scene bl-customize"
      data-step={step}
      role="img"
      aria-label="Silent product demo: a blank default card is claimed piece by piece — photo, card style, services and pricing, links, booking schedule, and recommended cuts — until it reads as the barber's own shop, not a marketplace profile."
    >
      <div aria-hidden className="bl-scene-inner">
        <ul className="bl-claim-list">
          {CUSTOMIZE_ITEMS.map((item, i) => (
            <li key={item} className={on(i + 1) ? 'is-done' : ''}>
              <span className="bl-claim-check"><CheckIcon /></span>
              <span className="font-sans">{item}</span>
            </li>
          ))}
        </ul>
        <div className="bl-customize-stage">
          <CardPhone ghost className="bl-customize-ghost" showIdentity={false} showServices={false} showBook={false} showLinks={false} showCuts={false} />
          <CardPhone
            theme={on(2) ? 'heritage' : 'night'}
            showIdentity={on(1)}
            showServices={on(3)}
            showBook={on(5)}
            showLinks={on(4)}
            showCuts={on(6)}
            className={`bl-customize-card${on(1) ? ' is-claimed' : ''}`}
          />
          <span className={`bl-yours-stamp font-mono${on(6) ? ' is-on' : ''}`}>YOURS</span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════ SCENE 4 — one card, everywhere ════════════ */

const EVERYWHERE_BEATS = [1900, 1800, 1800, 1800, 2000, 2200] as const;

const SURFACES = ['Instagram bio', 'Text thread', 'Mirror QR', 'Apple Wallet', 'Direct URL'] as const;

function EverywhereScene() {
  const { ref, step } = useScenePlayer(EVERYWHERE_BEATS);
  const active = Math.min(step, SURFACES.length - 1);

  return (
    <div
      ref={ref}
      className="bl-scene bl-everywhere"
      data-step={step}
      role="img"
      aria-label="Silent product demo: the same barber card travels across five surfaces — an Instagram bio link, a text message, the printed mirror QR card, an Apple Wallet pass, and the direct URL in a browser."
    >
      <div aria-hidden className="bl-scene-inner">
        <div className="bl-rail">
          <span className="bl-rail-token" style={{ left: `${(active / (SURFACES.length - 1)) * 100}%` }}><ScissorsIcon /></span>
          {SURFACES.map((surface, i) => (
            <span key={surface} className={`bl-rail-dot${i <= active ? ' is-passed' : ''}`} />
          ))}
        </div>
        <div className="bl-surfaces">
          {/* Instagram bio */}
          <div className={`bl-surface${active === 0 ? ' is-active' : ''}`}>
            <span className="bl-surface-tag font-mono">INSTAGRAM BIO</span>
            <div className="bl-ig">
              <div className="bl-ig-head">
                <span className="bl-ig-avatar font-display">MR</span>
                <div><b>fadetheory_marcus</b><small>Barber · Oakland</small></div>
              </div>
              <p>Walk-ins Tue–Sat. Book + try your next cut ↓</p>
              <span className="bl-link-chip font-mono">{DEMO.url}</span>
            </div>
          </div>
          {/* Text thread */}
          <div className={`bl-surface${active === 1 ? ' is-active' : ''}`}>
            <span className="bl-surface-tag font-mono">TEXT THREAD</span>
            <div className="bl-sms">
              <span className="bl-sms-in">you got time thursday?</span>
              <span className="bl-sms-out">grab a slot here
                <i className="bl-link-chip is-dark font-mono">{DEMO.url}</i>
              </span>
            </div>
          </div>
          {/* Mirror QR */}
          <div className={`bl-surface${active === 2 ? ' is-active' : ''}`}>
            <span className="bl-surface-tag font-mono">MIRROR QR</span>
            <div className="bl-surface-print">
              <span className="bl-tape" />
              <span className="font-mono">SCAN FOR MY CARD</span>
              <QrGlyph className="bl-mirror-qr" />
              <b className="font-display">Fade Theory</b>
            </div>
          </div>
          {/* Apple Wallet */}
          <div className={`bl-surface${active === 3 ? ' is-active' : ''}`}>
            <span className="bl-surface-tag font-mono">APPLE WALLET</span>
            <div className="bl-pass">
              <div className="bl-pass-head"><ScissorsIcon /><span className="font-mono">SHAPEUP</span></div>
              <b className="font-display">{DEMO.name}</b>
              <small>Fade Theory · Oakland</small>
              <span className="bl-pass-code" />
            </div>
          </div>
          {/* Direct URL */}
          <div className={`bl-surface${active === 4 ? ' is-active' : ''}`}>
            <span className="bl-surface-tag font-mono">DIRECT URL</span>
            <div className="bl-browser">
              <span className="bl-browser-bar font-mono"><GlobeIcon /> {DEMO.url}</span>
              <div className="bl-browser-card">
                <span className="bl-card-avatar font-display">MR</span>
                <div><b className="font-display">{DEMO.name}</b><small>{DEMO.shop}</small></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════ SCENE 5 — the receipt ═════════════════════ */

const RECEIPT_BEATS = [1300, 2300, 2500, 1900, 2100, 2400] as const;

function ReceiptScene() {
  const { ref, step, reduced } = useScenePlayer(RECEIPT_BEATS);
  const on = (n: number) => step >= n;
  const views = useCountUp(312, on(1), reduced);
  const tryOns = useCountUp(89, on(1), reduced);
  const bookingTaps = useCountUp(41, on(1), reduced);

  return (
    <div
      ref={ref}
      className="bl-scene bl-receipt-scene"
      data-step={step}
      role="img"
      aria-label="Silent product demo of the card's insights, printed like a till receipt with seeded demonstration data: 312 card views, 89 try-ons, and 41 booking taps in a week; the funnel from visit to try-on to booking fills in; the top requested cut is the blowout taper; two appointments and a client request with an attached preview arrive at the bottom."
    >
      <div aria-hidden className="bl-scene-inner">
        <div className="bl-receipt">
          <div className="bl-receipt-head">
            <span className="font-mono">FADE THEORY — CARD INSIGHTS</span>
            <span className="bl-demo-badge font-mono">SEEDED DEMO DATA</span>
          </div>
          <div className={`bl-receipt-stats${on(1) ? ' is-on' : ''}`}>
            <div><b className="font-display">{views}</b><span className="font-mono">CARD VIEWS · 7D</span></div>
            <div><b className="font-display">{tryOns}</b><span className="font-mono">TRY-ONS</span></div>
            <div><b className="font-display">{bookingTaps}</b><span className="font-mono">BOOKING TAPS</span></div>
          </div>
          <div className={`bl-funnel${on(2) ? ' is-on' : ''}`}>
            <div className="bl-funnel-row">
              <span className="font-sans">Visit</span><i style={{ transitionDelay: '0ms' }} /><span className="font-mono">100%</span>
            </div>
            <div className="bl-funnel-row">
              <span className="font-sans">Try-on</span><i style={{ transitionDelay: '350ms', transform: on(2) ? 'scaleX(0.29)' : undefined }} /><span className="font-mono">29%</span>
            </div>
            <div className="bl-funnel-row">
              <span className="font-sans">Booking tap</span><i style={{ transitionDelay: '700ms', transform: on(2) ? 'scaleX(0.13)' : undefined }} /><span className="font-mono">13%</span>
            </div>
            <p className="bl-funnel-read">Clients who finish a try-on book at 3× the rate of those who only browse.</p>
          </div>
          <div className={`bl-receipt-row${on(3) ? ' is-on' : ''}`}>
            <img src={thumb('blowout-taper')} alt="" width={40} height={40} loading="lazy" />
            <div><b>Top requested cut</b><span>Blowout taper · 23 try-ons this week</span></div>
          </div>
          <div className={`bl-receipt-row${on(4) ? ' is-on' : ''}`}>
            <span className="bl-receipt-icon"><CalendarIcon /></span>
            <div><b>Thu 3:30 PM — confirmed</b><span>Wolf cut · booked from the card</span></div>
          </div>
          <div className={`bl-receipt-row${on(4) ? ' is-on' : ''}`} style={{ transitionDelay: on(4) ? '260ms' : '0ms' }}>
            <span className="bl-receipt-icon"><ScissorsIcon /></span>
            <div><b>New client request</b><span>“Can you do this Friday?” · preview attached</span></div>
          </div>
          <div className="bl-receipt-tear" />
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════ page chrome ═══════════════════════════════ */

function BrandMark() {
  return (
    <Link href="/" className="bl-brand" aria-label="ShapeUp home">
      <img className="bl-brand-mark" src="/shapeup_logo_sm.png" alt="" width={38} height={38} aria-hidden />
      <span className="font-display">ShapeUp</span>
      <span className="bl-brand-product font-mono">Barber cards</span>
    </Link>
  );
}

const TICKER_PHRASES = [
  'TAPE IT TO THE MIRROR',
  'DROP IT IN YOUR BIO',
  'TEXT IT TO A REGULAR',
  'SCAN → TRY ON → BOOKED',
  'YOUR NAME ON THE URL',
];

function Ticker() {
  const run = TICKER_PHRASES.map((phrase, i) => (
    <span key={i}><i aria-hidden />{phrase}</span>
  ));
  return (
    <div className="bl-ticker" aria-label={`ShapeUp barber card: ${TICKER_PHRASES.join(', ').toLowerCase()}`}>
      <div className="bl-ticker-run font-mono" aria-hidden>
        {run}{run}
      </div>
    </div>
  );
}

export default function BarberLandingPage() {
  return (
    <div className="bl-root">
      <header className="bl-nav">
        <BrandMark />
        <nav aria-label="Main navigation">
          <a href="#try-on">Try-on</a>
          <a href="#watch">How it works</a>
          <a href="#insights">Insights</a>
        </nav>
        <div className="bl-nav-actions">
          <Link href="/sign-in" className="bl-text-link">Sign in</Link>
          <Link href="/barber" className="bl-button is-small">Build my card <ArrowIcon /></Link>
        </div>
      </header>

      <main>
        {/* ── 1 · hero: the card gets pressed ── */}
        <section className="bl-hero">
          <div className="bl-hero-copy">
            <p className="bl-eyebrow font-mono"><span /> FOR INDEPENDENT BARBERS</p>
            <h1 className="font-display">The only barber card your clients can <em>try on.</em></h1>
            <p className="bl-hero-lede">
              Your services, prices, links, and bookings on one card — plus a virtual
              try-on no other card has. Clients see the cut on their own head before
              they book.
            </p>
            <div className="bl-hero-actions">
              <Link href="/barber" className="bl-button">Build my barber card <ArrowIcon /></Link>
              <a href="#watch" className="bl-secondary-button">Watch how it works</a>
            </div>
            <ul className="bl-proof-list" aria-label="Product highlights">
              <li><span aria-hidden>✓</span> Live in minutes</li>
              <li><span aria-hidden>✓</span> QR, link + Apple Wallet</li>
              <li><span aria-hidden>✓</span> No client app needed</li>
            </ul>
          </div>
          <BuilderScene />
        </section>

        <Ticker />

        {/* ── 2 · try-on playground: the differentiator, shown not told ── */}
        <section className="bl-section" id="try-on">
          <div className="bl-section-heading">
            <p className="bl-eyebrow font-mono"><span /> THE FEATURE NO OTHER CARD HAS</p>
            <h2 className="font-display">Clients walk in knowing <em>exactly what they want.</em></h2>
            <p>
              Every cut on your card can be tried on. A client picks a style, watches it
              render on their own head, and books it — a preorder for the chair. These
              are real ShapeUp renders: one client, eight requests.
            </p>
          </div>
          <TryOnPlayground />
        </section>

        {/* ── 2b · client journey ── */}
        <section className="bl-section bl-dark-section" id="watch">
          <div className="bl-section-heading">
            <p className="bl-eyebrow font-mono"><span /> ONE SCAN AT THE MIRROR</p>
            <h2 className="font-display">From mirror to booked, <em>without leaving the chair.</em></h2>
            <p>
              A client scans the card on your mirror, tries your recommended cuts, and
              books a slot. The finished preview lands with you before they leave.
            </p>
          </div>
          <JourneyScene />
        </section>

        {/* ── 3 · customization ── */}
        <section className="bl-section" id="yours">
          <div className="bl-section-heading">
            <p className="bl-eyebrow font-mono"><span /> YOURS, NOT A MARKETPLACE&rsquo;S</p>
            <h2 className="font-display">A default card in. <em>Your shop&rsquo;s card out.</em></h2>
            <p>
              Photos, card style, services and prices, links and payments, your schedule,
              and the cuts you want to be known for. Set up in minutes — no platform
              branding over your name.
            </p>
          </div>
          <CustomizeScene />
        </section>

        {/* ── 4 · distribution ── */}
        <section className="bl-section bl-green-section">
          <div className="bl-section-heading">
            <p className="bl-eyebrow font-mono"><span /> SAME CARD, EVERY SURFACE</p>
            <h2 className="font-display">One card, everywhere your <em>clients already are.</em></h2>
            <p>
              Bio, text thread, mirror, Wallet, or the bare URL — one live card.
              Change a price once and every copy updates.
            </p>
          </div>
          <EverywhereScene />
        </section>

        {/* ── 5 · analytics ── */}
        <section className="bl-section" id="insights">
          <div className="bl-section-heading">
            <p className="bl-eyebrow font-mono"><span /> THE PART THAT PAYS RENT</p>
            <h2 className="font-display">Know what actually <em>fills the chair.</em></h2>
            <p>
              Every scan, try-on, booking tap, and client request is counted. See which
              cut pulls people in and where they drop off.
            </p>
          </div>
          <ReceiptScene />
          <p className="bl-data-note">
            Numbers above are seeded demonstration data from a sample card — not averages
            or claims about real barbers&rsquo; results.
          </p>
        </section>

        {/* ── 6 · barber proof (explicitly reserved — no invented quotes) ── */}
        <section className="bl-section bl-proof">
          <div className="bl-section-heading">
            <p className="bl-eyebrow font-mono"><span /> THE BARBER WALL</p>
            <h2 className="font-display">This wall is <em>reserved.</em></h2>
            <p>
              When the first cards have real mileage, their barbers go here — portrait,
              shop, a quote in their words, and the numbers behind it, linked to their live
              card. We don&rsquo;t print reviews we don&rsquo;t have.
            </p>
          </div>
          <div className="bl-proof-grid" aria-label="Reserved spots for future barber testimonials">
            {[1, 2, 3].map((n) => (
              <div key={n} className="bl-proof-frame">
                <div className="bl-proof-portrait"><ScissorsIcon /></div>
                <span className="font-mono">RESERVED FOR A WORKING BARBER</span>
                <b aria-hidden>———</b>
                <small aria-hidden>Shop · City</small>
              </div>
            ))}
          </div>
          <Link href="/barber" className="bl-inline-link">Put your shop here first <ArrowIcon /></Link>
        </section>

        {/* ── 7 · final CTA ── */}
        <section className="bl-final-cta">
          <p className="font-mono">LIVE IN MINUTES · LIVES ON YOUR MIRROR</p>
          <h2 className="font-display">One link for your brand, your bookings, <em>and your chair.</em></h2>
          <Link href="/barber" className="bl-button is-cream">Build my barber card <ArrowIcon /></Link>
        </section>
      </main>

      <footer className="bl-footer">
        <BrandMark />
        <p>The barber card with a built-in try-on.</p>
        <nav aria-label="Footer navigation">
          <Link href="/contact">Contact</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </footer>
    </div>
  );
}
