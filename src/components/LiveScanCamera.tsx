'use client';

/* ════════════════════════════════════════════════════════════════
   LiveScanCamera — the looking glass, now actually looking back.

   Real-time face tracking drives six live requirement checks:
     one face · centered · distance · facing forward · light · still
   The oval guide reacts (ink → tomato while coaching → butter when
   ready), then a 3-2-1 Fraunces countdown auto-fires the shutter:
   flash → polaroid develop → verify.

   Detection ladder:
     1. MediaPipe FaceLandmarker (CDN, GPU)   — full checks
     2. Native window.FaceDetector            — full checks minus "facing"
     3. Manual mode                           — light check only + manual shutter

   Drop-in notes (see INTEGRATION.md):
     · onChecksChange streams check state up to ScanPopup so the
       left panel can render the live checklist.
     · processCapture is where your existing ScanCamera upload
       pipeline goes (the part that returns profile/sessionId/url).
   ════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { UserHeadProfile } from '@/types';

/* ── Check model ─────────────────────────────────────────────── */
export type CheckKey = 'face' | 'center' | 'distance' | 'facing' | 'light' | 'still';
export type CheckState = 'idle' | 'fail' | 'pass';
export type ChecksMap = Record<CheckKey, CheckState>;

export const CHECK_META: Record<CheckKey, { label: string; coach: string }> = {
  face:     { label: 'One face in frame',      coach: 'step into the frame…' },
  center:   { label: 'Centered in the oval',   coach: 'find the middle of the oval' },
  distance: { label: 'Arm\u2019s length away', coach: 'a touch closer…' },
  facing:   { label: 'Facing forward',         coach: 'look straight at yourself' },
  light:    { label: 'Good, even light',       coach: 'find some light' },
  still:    { label: 'Holding still',          coach: 'hold it right there…' },
};

export const CHECK_ORDER: CheckKey[] = ['face', 'center', 'distance', 'facing', 'light', 'still'];

const FRESH_CHECKS = (): ChecksMap => ({
  face: 'idle', center: 'idle', distance: 'idle', facing: 'idle', light: 'idle', still: 'idle',
});

/* Hysteresis: a check must agree for N consecutive frames to flip. */
const PASS_FRAMES = 4;
const FAIL_FRAMES = 6;
const ALL_PASS_HOLD_MS = 750;   // dwell before countdown starts
const COUNTDOWN_TICK_MS = 720;

type Engine = 'mediapipe' | 'native' | 'manual';

interface FaceObservation {
  // all normalized 0..1 in *video* space (unmirrored)
  cx: number; cy: number;       // face box center
  w: number; h: number;         // face box size
  yawRatio: number | null;      // |nose→Leye| / |nose→Reye|, null if unknown
  count: number;                // faces seen
}

export interface LiveScanCameraProps {
  hairType: string;
  onScanComplete: (profile: UserHeadProfile, sessionId: string | null, url: string | null) => void;
  onDataUrlReady?: (dataUrl: string) => void;
  onChecksChange?: (checks: ChecksMap, allPass: boolean) => void;
  onDismiss?: () => void;
  onNoTokens?: () => void;
  paywallDisabled?: boolean;
  /* ── WIRE-IN POINT ───────────────────────────────────────────
     Plug the upload half of your old ScanCamera here: take the
     captured dataUrl, run your existing /api scan pipeline, and
     resolve with what handleCapture in ScanPopup expects.       */
  processCapture?: (dataUrl: string) => Promise<{
    profile: UserHeadProfile; sessionId: string | null; url: string | null;
  }>;
}

/* ── Upload an Image hover button ───────────────────────────── */
function UploadImageButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
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

  const BR = 8;
  const TRACE_INSET = 2;
  const STROKE_W = 1.5;
  const rx = Math.max(2, BR - TRACE_INSET);
  const rw = Math.max(0, dims.w - TRACE_INSET * 2);
  const rh = Math.max(0, dims.h - TRACE_INSET * 2);
  const perimeter = dims.w > 0
    ? 2 * ((rw - 2 * rx) + (rh - 2 * rx)) + 2 * Math.PI * rx
    : 0;

  const isHov = hovered && !disabled;

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: 'none',
        border: 'none',
        borderRadius: BR,
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: '7px 12px',
        fontFamily: 'var(--font-fraunces), Georgia, serif',
        fontVariationSettings: "'SOFT' 100, 'WONK' 0, 'opsz' 144",
        fontWeight: 700,
        fontSize: 15,
        letterSpacing: '-0.01em',
        color: isHov ? 'var(--char)' : 'rgba(255,248,234,0.85)',
        opacity: disabled ? 0.38 : 1,
        transition: 'transform 300ms cubic-bezier(0.34,1.56,0.64,1), color 200ms ease',
        transform: isHov ? 'scale(1.06)' : 'scale(1)',
        marginTop: 4,
      }}
    >
      {/* Amber fill — grows from center on hover */}
      <span aria-hidden style={{
        position: 'absolute', inset: 0,
        background: 'rgba(255,232,170,0.93)',
        clipPath: isHov ? `inset(0% round ${BR}px)` : `inset(50% round ${rx}px)`,
        transition: 'clip-path 560ms cubic-bezier(0.16,1,0.3,1)',
        pointerEvents: 'none', zIndex: 0,
      }} />

      {/* White SVG trace — draws around border on hover */}
      {perimeter > 0 && (
        <svg
          aria-hidden
          viewBox={`0 0 ${dims.w} ${dims.h}`}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            pointerEvents: 'none', zIndex: 1,
            filter: isHov ? 'drop-shadow(0 0 4px rgba(255,255,255,0.5))' : undefined,
            transition: 'filter 200ms ease',
          }}
        >
          <rect
            x={TRACE_INSET} y={TRACE_INSET}
            width={rw} height={rh}
            rx={rx} ry={rx}
            fill="none"
            stroke="rgba(255,255,255,0.88)"
            strokeWidth={STROKE_W}
            strokeDasharray={perimeter}
            strokeDashoffset={isHov ? 0 : perimeter}
            style={{ transition: `stroke-dashoffset ${isHov ? '680ms' : '140ms'} cubic-bezier(0.16,1,0.3,1)` }}
          />
        </svg>
      )}

      <span style={{ position: 'relative', zIndex: 2 }}>Upload an Image</span>
    </button>
  );
}

export default function LiveScanCamera({
  onScanComplete,
  onDataUrlReady,
  onChecksChange,
  processCapture,
}: LiveScanCameraProps) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const lumaCanvas  = useRef<HTMLCanvasElement | null>(null);
  const shotCanvas  = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rafRef      = useRef<number>(0);
  const engineRef   = useRef<Engine>('manual');
  const landmarkerRef = useRef<{ detectForVideo: (v: HTMLVideoElement, t: number) => { faceLandmarks: Array<Array<{ x: number; y: number; z: number }>> } } | null>(null);
  const nativeRef   = useRef<{ detect: (v: HTMLVideoElement) => Promise<Array<{ boundingBox: DOMRectReadOnly }>> } | null>(null);

  const [engine, setEngine]   = useState<Engine | 'booting'>('booting');
  const [camError, setCamError] = useState<string | null>(null);
  const [checks, setChecks]   = useState<ChecksMap>(FRESH_CHECKS);
  const [allPass, setAllPass] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [flash, setFlash]     = useState(false);
  const [shot, setShot]       = useState<string | null>(null); // dataUrl after capture
  const [uploading, setUploading] = useState(false);

  /* frame-loop scratch (refs to avoid re-render churn) */
  const passStreak = useRef<Record<CheckKey, number>>({ face: 0, center: 0, distance: 0, facing: 0, light: 0, still: 0 });
  const failStreak = useRef<Record<CheckKey, number>>({ face: 0, center: 0, distance: 0, facing: 0, light: 0, still: 0 });
  const liveChecks = useRef<ChecksMap>(FRESH_CHECKS());
  const lastCenters = useRef<Array<{ t: number; x: number; y: number }>>([]);
  const allPassSince = useRef<number | null>(null);
  const lastPublished = useRef<ChecksMap>(FRESH_CHECKS());
  const lastReady = useRef(false);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const capturedRef = useRef(false);
  const lastDetect = useRef(0);

  const checksUpRef = useRef(onChecksChange);
  checksUpRef.current = onChecksChange;

  /* ── Camera + detector boot ─────────────────────────────────── */
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        const v = videoRef.current;
        if (v) { v.srcObject = stream; await v.play().catch(() => {}); }
      } catch {
        if (!cancelled) setCamError('Camera unavailable — check browser permissions.');
        return;
      }

      /* detector ladder */
      try {
        // @ts-expect-error — CDN dynamic import, not resolvable by tsc
        const vision = await import(/* webpackIgnore: true */ 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
        const files = await vision.FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );
        const lm = await vision.FaceLandmarker.createFromOptions(files, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 2,
        });
        if (cancelled) return;
        landmarkerRef.current = lm;
        engineRef.current = 'mediapipe';
        setEngine('mediapipe');
        return;
      } catch { /* fall through */ }

      const FD = (window as unknown as { FaceDetector?: new (o: object) => { detect: (v: HTMLVideoElement) => Promise<Array<{ boundingBox: DOMRectReadOnly }>> } }).FaceDetector;
      if (FD) {
        try {
          nativeRef.current = new FD({ maxDetectedFaces: 2, fastMode: true });
          engineRef.current = 'native';
          setEngine('native');
          return;
        } catch { /* fall through */ }
      }
      engineRef.current = 'manual';
      setEngine('manual');
    })();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  /* ── Per-frame observation ──────────────────────────────────── */
  const observe = useCallback(async (now: number): Promise<FaceObservation | null> => {
    const v = videoRef.current;
    if (!v || v.readyState < 2 || v.paused || !v.videoWidth || !v.videoHeight) return null;
    const eng = engineRef.current;

    if (eng === 'mediapipe' && landmarkerRef.current) {
      let res: { faceLandmarks?: Array<Array<{ x: number; y: number }>> };
      try { res = landmarkerRef.current.detectForVideo(v, now); }
      catch { return null; }
      const faces = res.faceLandmarks ?? [];
      if (!faces.length) return { cx: 0, cy: 0, w: 0, h: 0, yawRatio: null, count: 0 };
      const pts = faces[0];
      let minX = 1, minY = 1, maxX = 0, maxY = 0;
      for (const p of pts) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      const nose = pts[1], lEye = pts[33], rEye = pts[263];
      const dl = Math.hypot(nose.x - lEye.x, nose.y - lEye.y);
      const dr = Math.hypot(nose.x - rEye.x, nose.y - rEye.y);
      return {
        cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
        w: maxX - minX, h: maxY - minY,
        yawRatio: dr > 0.0001 ? dl / dr : null,
        count: faces.length,
      };
    }

    if (eng === 'native' && nativeRef.current) {
      try {
        const faces = await nativeRef.current.detect(v);
        if (!faces.length) return { cx: 0, cy: 0, w: 0, h: 0, yawRatio: null, count: 0 };
        const b = faces[0].boundingBox;
        return {
          cx: (b.x + b.width / 2) / v.videoWidth,
          cy: (b.y + b.height / 2) / v.videoHeight,
          w: b.width / v.videoWidth, h: b.height / v.videoHeight,
          yawRatio: null,
          count: faces.length,
        };
      } catch { return null; }
    }
    return null; // manual
  }, []);

  /* mean luma inside (or near) the face box, 0–255 */
  const sampleLuma = useCallback((obs: FaceObservation | null): number | null => {
    const v = videoRef.current;
    if (!v || v.readyState < 2) return null;
    if (!lumaCanvas.current) lumaCanvas.current = document.createElement('canvas');
    const c = lumaCanvas.current;
    c.width = 48; c.height = 48;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, 48, 48);
    const box = obs && obs.count > 0
      ? { x: Math.max(0, (obs.cx - obs.w / 2) * 48), y: Math.max(0, (obs.cy - obs.h / 2) * 48), w: Math.min(48, obs.w * 48), h: Math.min(48, obs.h * 48) }
      : { x: 12, y: 12, w: 24, h: 24 };
    const data = ctx.getImageData(box.x | 0, box.y | 0, Math.max(1, box.w | 0), Math.max(1, box.h | 0)).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    return sum / (data.length / 4);
  }, []);

  /* ── The judging loop ───────────────────────────────────────── */
  useEffect(() => {
    if (engine === 'booting' || camError || shot) return;

    const judge = (key: CheckKey, ok: boolean) => {
      if (ok) { passStreak.current[key]++; failStreak.current[key] = 0; }
      else    { failStreak.current[key]++; passStreak.current[key] = 0; }
      const cur = liveChecks.current[key];
      if (cur !== 'pass' && passStreak.current[key] >= PASS_FRAMES) liveChecks.current[key] = 'pass';
      if (cur !== 'fail' && failStreak.current[key] >= FAIL_FRAMES) liveChecks.current[key] = 'fail';
    };

    let alive = true;
    const loop = async () => {
      if (!alive) return;
      const now = performance.now();

      if (now - lastDetect.current >= 90) {           // ~11 fps detection
        lastDetect.current = now;
        const obs = await observe(now);
        const luma = sampleLuma(obs);
        const manual = engineRef.current === 'manual';

        if (!manual && obs) {
          judge('face', obs.count === 1);
          if (obs.count === 1) {
            judge('center', Math.abs(obs.cx - 0.5) < 0.13 && Math.abs(obs.cy - 0.46) < 0.15);
            judge('distance', obs.h > 0.30 && obs.h < 0.68);
            judge('facing', obs.yawRatio === null ? true : obs.yawRatio > 0.62 && obs.yawRatio < 1.62);
            /* stillness over a 600ms window */
            lastCenters.current.push({ t: now, x: obs.cx, y: obs.cy });
            lastCenters.current = lastCenters.current.filter(p => now - p.t < 600);
            const pts = lastCenters.current;
            let drift = 0;
            for (let i = 1; i < pts.length; i++) drift += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
            judge('still', pts.length > 3 && drift < 0.055);
          } else {
            (['center', 'distance', 'facing', 'still'] as CheckKey[]).forEach(k => judge(k, false));
          }
        }
        if (luma !== null) judge('light', luma > 58 && luma < 215);

        /* publish only when something actually changed */
        const snapshot = { ...liveChecks.current };
        const ready = manual
          ? snapshot.light === 'pass'
          : CHECK_ORDER.every(k => snapshot[k] === 'pass');
        const changed = CHECK_ORDER.some(k => lastPublished.current[k] !== snapshot[k]) || ready !== lastReady.current;
        if (changed) {
          lastPublished.current = snapshot;
          lastReady.current = ready;
          setChecks(snapshot);
          setAllPass(ready);
          checksUpRef.current?.(snapshot, ready);
        }

        /* auto-capture orchestration (detection engines only) */
        if (!manual) {
          if (ready) {
            if (allPassSince.current === null) allPassSince.current = now;
            else if (now - allPassSince.current > ALL_PASS_HOLD_MS && countdownTimer.current === null && !capturedRef.current) {
              startCountdown();
            }
          } else {
            allPassSince.current = null;
            if (countdownTimer.current !== null) cancelCountdown();
          }
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, camError, shot]);

  /* ── Countdown + shutter ────────────────────────────────────── */
  const cancelCountdown = () => {
    if (countdownTimer.current !== null) { clearInterval(countdownTimer.current); countdownTimer.current = null; }
    setCountdown(null);
  };

  const startCountdown = () => {
    let n = 3;
    setCountdown(3);
    countdownTimer.current = setInterval(() => {
      n -= 1;
      if (n <= 0) { cancelCountdown(); fireShutter(); }
      else setCountdown(n);
    }, COUNTDOWN_TICK_MS);
  };

  const fireShutter = () => {
    if (capturedRef.current) return;
    const v = videoRef.current;
    if (!v || v.readyState < 2) return;
    capturedRef.current = true;

    setFlash(true);
    setTimeout(() => setFlash(false), 160);

    if (!shotCanvas.current) shotCanvas.current = document.createElement('canvas');
    const c = shotCanvas.current;
    const side = Math.min(v.videoWidth, v.videoHeight);
    c.width = side; c.height = side;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    /* center-crop square, mirrored to match the preview the user saw */
    ctx.save();
    ctx.translate(side, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, side, side);
    ctx.restore();
    const dataUrl = c.toDataURL('image/jpeg', 0.92);
    onDataUrlReady?.(dataUrl);
    setShot(dataUrl);

    setTimeout(async () => {
      setUploading(true);
      try {
        if (processCapture) {
          const { profile, sessionId, url } = await processCapture(dataUrl);
          onScanComplete(profile, sessionId, url);
        } else {
          /* TODO: replace with your old ScanCamera upload pipeline.
             Until wired, hand the raw dataUrl up so the flow still moves. */
          onScanComplete({} as UserHeadProfile, null, dataUrl);
        }
      } finally {
        setUploading(false);
      }
    }, 950); // let the develop animation breathe first
  };

  const handleManualShutter = () => {
    if (countdownTimer.current !== null || capturedRef.current) return;
    fireShutter();
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (capturedRef.current) return;
    capturedRef.current = true;

    cancelCountdown();

    try {
      const bitmap = await createImageBitmap(file);
      const side = Math.min(bitmap.width, bitmap.height);
      if (!shotCanvas.current) shotCanvas.current = document.createElement('canvas');
      const c = shotCanvas.current;
      c.width = side; c.height = side;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, side, side);
      bitmap.close();
      const dataUrl = c.toDataURL('image/jpeg', 0.92);
      onDataUrlReady?.(dataUrl);
      setShot(dataUrl);

      setTimeout(async () => {
        setUploading(true);
        try {
          if (processCapture) {
            const { profile, sessionId, url } = await processCapture(dataUrl);
            onScanComplete(profile, sessionId, url);
          } else {
            onScanComplete({} as UserHeadProfile, null, dataUrl);
          }
        } finally {
          setUploading(false);
        }
      }, 950);
    } catch {
      capturedRef.current = false;
    }
  };

  /* ── Oval guide state → color ───────────────────────────────── */
  const detecting = engine === 'mediapipe' || engine === 'native';
  const anyFail = CHECK_ORDER.some(k => checks[k] === 'fail');
  const ringTone = allPass ? 'ready' : anyFail ? 'coach' : 'idle';
  const ringColor = ringTone === 'ready' ? 'var(--butter)' : ringTone === 'coach' ? 'var(--tomato)' : 'rgba(255,248,234,0.45)';

  /* first failing check decides the coaching line */
  const firstIssue = CHECK_ORDER.find(k => checks[k] !== 'pass');
  const coachLine = !detecting
    ? (engine === 'booting' ? 'warming up the chair…' : 'line yourself up, then tap the shutter')
    : countdown !== null
    ? `looking sharp — ${countdown}`
    : allPass
    ? 'hold it right there…'
    : firstIssue
    ? CHECK_META[firstIssue].coach
    : 'line yourself up…';

  /* ════════════════════ RENDER ════════════════════ */
  return (
    <div className="lsc-root">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleUpload}
      />
      {/* ── viewfinder ── */}
      <div className={`lsc-frame ${ringTone === 'ready' ? 'lsc-frame-ready' : ''}`}>
        <video ref={videoRef} playsInline muted className="lsc-video" />
        <div className="lsc-grain" aria-hidden />

        {/* oval guide */}
        <svg className="lsc-oval" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs>
            <mask id="lsc-cut"><rect width="100" height="100" fill="white" /><ellipse cx="50" cy="46" rx="30" ry="38" fill="black" /></mask>
          </defs>
          <rect width="100" height="100" fill="rgba(20,14,10,0.42)" mask="url(#lsc-cut)" />
          <ellipse
            cx="50" cy="46" rx="30" ry="38" fill="none"
            stroke={ringColor} strokeWidth={ringTone === 'ready' ? 1.6 : 1.1}
            strokeDasharray={ringTone === 'ready' ? 'none' : '3.5 2.6'}
            vectorEffect="non-scaling-stroke"
            className={ringTone === 'ready' ? 'lsc-oval-ready' : 'lsc-oval-dash'}
            style={{ transition: 'stroke 280ms ease, stroke-width 280ms ease' }}
          />
        </svg>

        {/* countdown numeral */}
        {countdown !== null && (
          <div key={countdown} className="lsc-count font-display">{countdown}</div>
        )}

        {/* shutter flash */}
        <div className="lsc-flash" style={{ opacity: flash ? 1 : 0, transition: flash ? 'none' : 'opacity 160ms ease-out' }} aria-hidden />

        {/* developed shot — polaroid develop over the live feed */}
        {shot && (
          <div className="lsc-develop">
            <img src={shot} alt="Your selfie" className="lsc-develop-img" />
          </div>
        )}

        {/* engine pip */}
        <div className="lsc-pip font-mono">
          {engine === 'booting' ? 'loading lens…' : detecting ? '● live face tracking' : '○ manual mode'}
        </div>

        {camError && (
          <div className="lsc-error">
            <span className="font-mono" style={{ fontSize: 11 }}>{camError}</span>
          </div>
        )}
      </div>

      {/* ── caption + shutter ── */}
      <p className="lsc-caption font-display" key={coachLine}>{coachLine}</p>
      <div className="lsc-shutter-row">
        <button
          type="button"
          onClick={handleManualShutter}
          disabled={!!shot || uploading || engine === 'booting' || !!camError}
          className={`lsc-shutter ${allPass || !detecting ? 'lsc-shutter-armed' : ''}`}
          aria-label="Take photo"
        >
          <span className="lsc-shutter-core" />
        </button>
      </div>

      {uploading && (
        <p className="font-mono lsc-uploading">developing…</p>
      )}

      {!shot && !uploading && (
        <UploadImageButton
          onClick={() => fileInputRef.current?.click()}
          disabled={engine === 'booting'}
        />
      )}
    </div>
  );
}
