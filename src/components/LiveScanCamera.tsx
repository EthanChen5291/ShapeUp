'use client';

/* ════════════════════════════════════════════════════════════════
   LiveScanCamera — the looking glass, now actually looking back.

   Real-time face tracking drives five live requirement checks:
     one face · distance · facing forward · light · still
   The oval guide reacts (ink → tomato while coaching → butter when
   ready). The user fires the shutter themselves:
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

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserHeadProfile } from '@/types';

/* ── Check model ─────────────────────────────────────────────── */
export type CheckKey = 'face' | 'distance' | 'facing' | 'light' | 'still';
export type CheckState = 'idle' | 'fail' | 'pass';
export type ChecksMap = Record<CheckKey, CheckState>;

export const CHECK_META: Record<CheckKey, { label: string; coach: string }> = {
  face:     { label: 'One face in frame',      coach: 'step into the frame…' },
  distance: { label: 'Arm\u2019s length away', coach: 'a touch closer…' },
  facing:   { label: 'Facing forward',         coach: 'look straight at yourself' },
  light:    { label: 'Good, even light',       coach: 'find some light' },
  still:    { label: 'Holding still',          coach: 'hold it right there…' },
};

export const CHECK_ORDER: CheckKey[] = ['face', 'distance', 'facing', 'light', 'still'];

const FRESH_CHECKS = (): ChecksMap => ({
  face: 'idle', distance: 'idle', facing: 'idle', light: 'idle', still: 'idle',
});

/* Hysteresis: a check must agree for N consecutive frames to flip. */
const PASS_FRAMES = 4;
const FAIL_FRAMES = 6;

/* Head-tilt tolerance: eye-line more than this many degrees off level reads as tilted. */
const TILT_DEG = 8;

type Engine = 'mediapipe' | 'native' | 'manual';

interface FaceObservation {
  // all normalized 0..1 in *video* space (unmirrored)
  cx: number; cy: number;       // face box center
  w: number; h: number;         // face box size
  yawRatio: number | null;      // |nose→Leye| / |nose→Reye|, null if unknown
  roll: number | null;          // eye-line angle off horizontal in degrees, null if unknown
  count: number;                // faces seen
}

export interface LiveScanCameraProps {
  hairType: string;
  onScanComplete: (profile: UserHeadProfile, sessionId: string | null, url: string | null, scanS3Key: string | null) => void;
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
    profile: UserHeadProfile; sessionId: string | null; url: string | null; scanS3Key: string | null;
  }>;
}

/* ── Upload an Image hover button ───────────────────────────── */
function UploadImageButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  const [hovered, setHovered] = useState(false);
  const isHov = hovered && !disabled;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="font-display"
      style={{
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        alignSelf: 'center',
        width: 'fit-content',
        padding: '9px 19px',
        borderRadius: 17,
        background: 'var(--butter, #ffe7b0)',
        color: 'var(--char, #1a1410)',
        fontSize: 15,
        fontWeight: 600,
        letterSpacing: '0.01em',
        lineHeight: 1.3,
        boxShadow: '0 6px 18px -8px rgba(0, 0, 0, 0.45)',
        opacity: disabled ? 0.38 : 1,
        transformOrigin: 'center',
        transform: isHov ? 'scale(1.06)' : 'scale(1)',
        transition: 'transform 360ms cubic-bezier(0.16,1,0.3,1)',
        marginTop: 4,
      }}
    >
      Upload an Image
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
  const [flash, setFlash]     = useState(false);
  const [shot, setShot]       = useState<string | null>(null); // dataUrl after capture
  const [uploading, setUploading] = useState(false);
  const [tilted, setTilted]   = useState(false);  // head rolled off level → side message
  const [confirmOpen, setConfirmOpen] = useState(false); // "checks not met" guard
  const [confirmFails, setConfirmFails] = useState<CheckKey[]>([]); // frozen at popup-open

  /* frame-loop scratch (refs to avoid re-render churn) */
  const passStreak = useRef<Record<CheckKey, number>>({ face: 0, distance: 0, facing: 0, light: 0, still: 0 });
  const failStreak = useRef<Record<CheckKey, number>>({ face: 0, distance: 0, facing: 0, light: 0, still: 0 });
  const liveChecks = useRef<ChecksMap>(FRESH_CHECKS());
  const lastCenters = useRef<Array<{ t: number; x: number; y: number }>>([]);
  const lastPublished = useRef<ChecksMap>(FRESH_CHECKS());
  const lastReady = useRef(false);
  const capturedRef = useRef(false);
  const pendingShotRef = useRef<string | null>(null); // frozen frame awaiting confirm
  const lastDetect = useRef(0);
  /* tilt debounce — flip the side message only after a few agreeing frames */
  const tiltStreak = useRef(0);
  const levelStreak = useRef(0);
  const tiltedRef = useRef(false);

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
      if (!faces.length) return { cx: 0, cy: 0, w: 0, h: 0, yawRatio: null, roll: null, count: 0 };
      const pts = faces[0];
      let minX = 1, minY = 1, maxX = 0, maxY = 0;
      for (const p of pts) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      const nose = pts[1], lEye = pts[33], rEye = pts[263];
      const dl = Math.hypot(nose.x - lEye.x, nose.y - lEye.y);
      const dr = Math.hypot(nose.x - rEye.x, nose.y - rEye.y);
      /* roll = angle of the eye line off horizontal; magnitude is mirror-invariant */
      const roll = Math.atan2(rEye.y - lEye.y, rEye.x - lEye.x) * 180 / Math.PI;
      return {
        cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
        w: maxX - minX, h: maxY - minY,
        yawRatio: dr > 0.0001 ? dl / dr : null,
        roll,
        count: faces.length,
      };
    }

    if (eng === 'native' && nativeRef.current) {
      try {
        const faces = await nativeRef.current.detect(v);
        if (!faces.length) return { cx: 0, cy: 0, w: 0, h: 0, yawRatio: null, roll: null, count: 0 };
        const b = faces[0].boundingBox;
        return {
          cx: (b.x + b.width / 2) / v.videoWidth,
          cy: (b.y + b.height / 2) / v.videoHeight,
          w: b.width / v.videoWidth, h: b.height / v.videoHeight,
          yawRatio: null,
          roll: null,
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
            (['distance', 'facing', 'still'] as CheckKey[]).forEach(k => judge(k, false));
          }

          /* head-tilt (roll) side message — only with landmarks (mediapipe) */
          if (obs.count === 1 && obs.roll !== null) {
            const isTilted = Math.abs(obs.roll) > TILT_DEG;
            if (isTilted) { tiltStreak.current++; levelStreak.current = 0; }
            else          { levelStreak.current++; tiltStreak.current = 0; }
            if (!tiltedRef.current && tiltStreak.current >= PASS_FRAMES) {
              tiltedRef.current = true; setTilted(true);
            } else if (tiltedRef.current && levelStreak.current >= FAIL_FRAMES) {
              tiltedRef.current = false; setTilted(false);
            }
          } else if (tiltedRef.current) {
            /* lost the face / no landmarks — clear the message */
            tiltedRef.current = false; setTilted(false);
            tiltStreak.current = 0; levelStreak.current = 0;
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
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, camError, shot]);

  /* ── Shutter ────────────────────────────────────────────────── */
  /* Grab the current video frame as a square, mirrored dataUrl — a pure
     snapshot with no side effects, so the moment the user presses the
     button is the moment that gets frozen and (later) processed. */
  const captureFrame = (): string | null => {
    const v = videoRef.current;
    if (!v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return null;
    if (!shotCanvas.current) shotCanvas.current = document.createElement('canvas');
    const c = shotCanvas.current;
    const side = Math.min(v.videoWidth, v.videoHeight);
    c.width = side; c.height = side;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    /* center-crop square, mirrored to match the preview the user saw */
    ctx.save();
    ctx.translate(side, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, side, side);
    ctx.restore();
    return c.toDataURL('image/jpeg', 0.92);
  };

  /* Commit an already-captured frame: flash, develop, and run the upload
     pipeline. Takes the dataUrl so the frozen frame is what gets processed. */
  const commitShot = (dataUrl: string) => {
    if (capturedRef.current) return;
    capturedRef.current = true;

    setFlash(true);
    setTimeout(() => setFlash(false), 160);

    onDataUrlReady?.(dataUrl);
    setShot(dataUrl);

    setTimeout(async () => {
      setUploading(true);
      try {
        if (processCapture) {
          const { profile, sessionId, url, scanS3Key } = await processCapture(dataUrl);
          onScanComplete(profile, sessionId, url, scanS3Key);
        } else {
          /* TODO: replace with your old ScanCamera upload pipeline.
             Until wired, hand the raw dataUrl up so the flow still moves. */
          onScanComplete({} as UserHeadProfile, null, dataUrl, null);
        }
      } finally {
        setUploading(false);
      }
    }, 950); // let the develop animation breathe first
  };

  const fireShutter = () => {
    if (capturedRef.current) return;
    const dataUrl = captureFrame();
    if (!dataUrl) return;
    commitShot(dataUrl);
  };

  const handleManualShutter = () => {
    if (capturedRef.current || confirmOpen) return;
    /* When detection is live but the checklist isn't fully met, the shutter
       isn't "armed" (red). Freeze the frame and the unmet checks right now,
       then ask the user to confirm before processing that exact selfie. */
    if (detecting && !allPass) {
      const dataUrl = captureFrame();
      if (!dataUrl) return;
      pendingShotRef.current = dataUrl;
      setConfirmFails(CHECK_ORDER.filter(k => checks[k] !== 'pass'));
      setConfirmOpen(true);
      return;
    }
    fireShutter();
  };

  const confirmCapture = () => {
    setConfirmOpen(false);
    const frozen = pendingShotRef.current;
    pendingShotRef.current = null;
    if (frozen) commitShot(frozen);
    else fireShutter();
  };

  const cancelConfirm = () => {
    setConfirmOpen(false);
    pendingShotRef.current = null;
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (capturedRef.current) return;
    capturedRef.current = true;

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
            const { profile, sessionId, url, scanS3Key } = await processCapture(dataUrl);
            onScanComplete(profile, sessionId, url, scanS3Key);
          } else {
            onScanComplete({} as UserHeadProfile, null, dataUrl, null);
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
      <div className="lsc-stage">
        {/* head-tilt nudge — floats to the left of the camera */}
        <div className={`lsc-tilt-msg font-mono ${tilted && !shot && !camError ? 'is-on' : ''}`} role="status" aria-hidden={!tilted}>
          Your head looks tilted — straighten it up so it’s level.
        </div>

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
          {engine === 'booting' ? 'loading lens…' : detecting ? '● live' : '○ manual mode'}
        </div>

        {camError && (
          <div className="lsc-error">
            <span className="font-mono" style={{ fontSize: 11 }}>{camError}</span>
          </div>
        )}
        </div>
      </div>

      {/* ── shutter ── */}
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
        <>
          <div className="lsc-pose-guide" aria-hidden>
            <img src="/frontfacing_female_eyes.png" alt="" className="lsc-pose-img lsc-pose-a" />
            <img src="/frontfacing_male_eyes.png" alt="" className="lsc-pose-img lsc-pose-b" />
          </div>
          <div className="lsc-upload-cluster">
            <UploadImageButton
              onClick={() => fileInputRef.current?.click()}
              disabled={engine === 'booting'}
            />
          </div>
        </>
      )}

      {/* ── checks-not-met confirmation ── */}
      {confirmOpen && (
        <div className="lsc-confirm-veil" role="dialog" aria-modal="true" onClick={cancelConfirm}>
          <div className="lsc-confirm-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display lsc-confirm-title">Take it anyway?</h3>
            <p className="lsc-confirm-body">
              These recommendations aren&rsquo;t met yet. Capturing now can lower the quality of your scan:
            </p>
            <ul className="lsc-confirm-list">
              {confirmFails.map((k) => (
                <li key={k}>{CHECK_META[k].label}</li>
              ))}
            </ul>
            <div className="lsc-confirm-actions">
              <button type="button" className="lsc-confirm-cancel font-display" onClick={cancelConfirm}>
                Keep adjusting
              </button>
              <button type="button" className="lsc-confirm-go" onClick={confirmCapture}>
                Take it anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
