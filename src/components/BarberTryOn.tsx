'use client';

// ============================================================
// BarberTryOn — the "see it on your own head" flow on the barber card.
//
// No longer a modal: this renders INSIDE the card's ShapeUp panel (the right
// side of the diagonal on desktop, the flow section on mobile), swapping in
// place of the lookbook so discovery → selfie → result reads as one journey.
//
// The flow is a state machine, not a pile of booleans:
//
//   intro → (auth) → capture → checking → [confirm] → uploading
//         → editing → rendering → result ⇄ sending/sent
//
// with a recoverable `error` string carried alongside rather than as a state
// of its own — an error never dumps the client back to the start.
//
// Every step past the intro needs a real Clerk identity — /api/gemini-hair-edit
// has no anonymous path (see convex/barberTryOn.ts's header comment) — so a
// visitor who isn't signed in sees an inline SignUpWidget first. That sign-in
// is also where the client's contact email comes from for "send to barber".
//
// GPU warm-up: the primary worker cold-starts in ~6–8s, so we poke
// /api/facelift/warmup (fire-and-forget, auth-required, never spends credits)
// the moment the selfie step becomes visible and again when a pipeline run
// starts — by the time the /api/facelift call lands the container is up.
//
// Generation always edits from the ORIGINAL selfie, never the last result —
// same anti-drift rule EditPanel follows. The selfie itself is lifted to
// BarberCard (initialSelfieUrl/onSelfie) so "try another cut" doesn't ask the
// client to re-shoot their face.
//
// A visitor who signs in here never passes through `/` (src/app/page.tsx),
// which is the only place that normally calls `users.getOrCreate` with the
// barber's referral code — so without doing it here too, every sign-up
// through this flow would silently un-attribute itself from the barber who
// sent them. See src/lib/referral.ts for the same attribution off the "/" path.
//
// The result is the REAL 3D splat viewer (HairScene) via the same two-step
// pipeline the studio runs (/api/gemini-hair-edit → /api/facelift), wired
// into renderStations so a queued GPU render is honest about wait time. If
// the 3D step fails, the 2D edited photo stays on screen (sceneFailed) so the
// flow never dead-ends.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useUser } from '@clerk/nextjs';
import { useConvex, useMutation, useQuery, useAction } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import type { Hairstyle } from '@/data/hairstyles';
import type { HairParams } from '@/types';
import SignUpWidget from '@/components/SignUpWidget';
import SelfieCapture from '@/components/SelfieCapture';
import { analyzeSelfie, judgeSelfie, type SelfieVerdict } from '@/lib/selfieCheck';
import { getVisitorId } from '@/lib/visitorId';
import { useT } from '@/lib/i18n';

const HairScene = dynamic(() => import('@/components/HairScene'), { ssr: false });

// HairScene's `params` prop only drives the (currently unused) placeholder
// .glb mesh path — with disableDefaultHairLayers the splat is the only thing
// rendered, so any valid HairParams satisfies the type without affecting output.
const PLACEHOLDER_HAIR_PARAMS: HairParams = {
  topLength: 1, sideLength: 1, backLength: 1, messiness: 0.2, taper: 0.5,
  pc1: 0, pc2: 0, pc3: 0, pc4: 0, pc5: 0, pc6: 0,
};

export interface BarberTryOnProps {
  barberSlug: string;
  /** For the "Book with {name}" close of the loop. */
  barberName: string;
  cut: Hairstyle;
  /** The barber's other cuts, offered as quick re-edit chips. */
  otherCuts: Hairstyle[];
  /** Cuts specifically selected by this barber. */
  barberPicks?: Hairstyle[];
  /** The complete generated hairstyle menu. */
  menuCuts?: Hairstyle[];
  /** Attributes a sign-up through this flow back to the barber who sent them. */
  referralCode?: string;
  /** The barber's booking link, when they have one — shown on the result. */
  bookingUrl?: string;
  /** Native scheduling: jump to the card's slot picker instead of an external link. */
  onBook?: () => void;
  /** A selfie kept from an earlier run this visit — skips straight to generating. */
  initialSelfieUrl?: string | null;
  /** The hosted selfie URL, lifted so the next cut doesn't re-ask for a face. */
  onSelfie?: (url: string) => void;
  onClose: () => void;
}

type Phase =
  | 'intro'
  | 'capture'
  | 'checking'
  | 'confirm'
  | 'uploading'
  | 'editing'
  | 'rendering'
  | 'result'
  | 'sending'
  | 'sent';

const GENERATING_PHASES: Phase[] = ['uploading', 'editing', 'rendering'];

function BackIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** Upload one file (or a data: URL's bytes) to Convex storage and resolve a fetchable URL. */
function useConvexUpload() {
  const convex = useConvex();
  const generateUploadUrl = useMutation(api.barberTryOn.generateUploadUrl);

  return useCallback(
    async (blob: Blob): Promise<string> => {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'application/octet-stream' },
        body: blob,
      });
      if (!res.ok) throw new Error('Upload failed');
      const { storageId } = await res.json();
      const url = await convex.query(api.barberTryOn.getUploadedImageUrl, { storageId });
      if (!url) throw new Error('Upload succeeded but no URL came back');
      return url;
    },
    [convex, generateUploadUrl],
  );
}

/** The staged progress list — real stages, no fake percentages. */
function StageTracker({ phase, queuedBehind }: { phase: Phase; queuedBehind: number | null }) {
  const t = useT();
  const stages = [
    { key: 'uploading', label: t('Preparing your preview') },
    { key: 'editing', label: t('Applying the hairstyle') },
    { key: 'rendering', label: t('Building your 3D look') },
  ] as const;
  const activeIdx = stages.findIndex((s) => s.key === phase);
  return (
    <ol className="bt-stages" aria-live="polite">
      {stages.map((stage, i) => {
        const state = activeIdx < 0 || i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'todo';
        return (
          <li key={stage.key} className={`bt-stage is-${state}`}>
            <span className="bt-stage-dot" aria-hidden>
              {state === 'done' ? <CheckIcon /> : null}
            </span>
            <span className="bt-stage-label font-sans">
              {stage.label}
              {stage.key === 'rendering' && state === 'active' && queuedBehind !== null
                ? ` — ${t('{n} ahead of you', { n: queuedBehind })}`
                : ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function BarberTryOn({
  barberSlug,
  barberName,
  cut,
  otherCuts,
  barberPicks = otherCuts,
  menuCuts = otherCuts,
  referralCode,
  bookingUrl,
  onBook,
  initialSelfieUrl = null,
  onSelfie,
  onClose,
}: BarberTryOnProps) {
  const t = useT();
  const { isSignedIn, user } = useUser();
  const upload = useConvexUpload();
  const sendToBarber = useAction(api.barberTryOn.sendToBarber);
  const getOrCreate = useMutation(api.users.getOrCreate);
  const recordEvent = useMutation(api.barberPages.recordEvent);

  // GPU render-station queue — same mechanism EditPanel uses to be honest
  // about wait time when the primary worker's container cap is saturated.
  const claimStation = useMutation(api.renderStations.claim);
  const heartbeatStation = useMutation(api.renderStations.heartbeat);
  const releaseStation = useMutation(api.renderStations.release);
  const stationJobIdRef = useRef<Id<'renderStations'> | null>(null);
  const stationHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [stationJobId, setStationJobId] = useState<Id<'renderStations'> | null>(null);
  const station = useQuery(
    api.renderStations.status,
    stationJobId ? { jobId: stationJobId } : 'skip',
  );
  const queuedBehind = station?.status === 'queued' ? station.queuePosition : null;

  const releaseStationRef = useRef(releaseStation);
  releaseStationRef.current = releaseStation;
  useEffect(() => () => {
    if (stationHeartbeatRef.current) clearInterval(stationHeartbeatRef.current);
    const id = stationJobIdRef.current;
    if (id) void releaseStationRef.current({ jobId: id }).catch(() => {});
  }, []);

  // Fires once, the moment sign-in completes — same attribution `/` does via
  // getPendingReferralCode(), just triggered locally since this flow never
  // visits `/`.
  const attributedRef = useRef(false);
  useEffect(() => {
    if (!isSignedIn || attributedRef.current) return;
    attributedRef.current = true;
    void getOrCreate({ referralCode }).catch((err) => console.error('[BarberTryOn] getOrCreate FAILED:', err));
  }, [isSignedIn, referralCode, getOrCreate]);

  const [activeCut, setActiveCut] = useState(cut);
  const [phase, setPhase] = useState<Phase>('intro');
  const [error, setError] = useState('');
  const [verdict, setVerdict] = useState<SelfieVerdict | null>(null);
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [sourceImageUrl, setSourceImageUrl] = useState<string | null>(initialSelfieUrl);
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  const [splatSrc, setSplatSrc] = useState<string | null>(null);
  const [turntableVideoUrl, setTurntableVideoUrl] = useState<string | null>(null);
  const [lastAppliedPrompt, setLastAppliedPrompt] = useState(cut.label);
  const [sceneFailed, setSceneFailed] = useState(false);
  const [showBefore, setShowBefore] = useState(false);
  const [sceneKey, setSceneKey] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [sendOutcome, setSendOutcome] = useState<'emailed' | 'saved' | 'failed' | null>(null);
  const [resultShelf, setResultShelf] = useState<'picks' | 'menu'>('picks');
  const sessionIdRef = useRef(`barber-tryon-${Math.random().toString(36).slice(2)}`);

  // Fire-and-forget counters — a dropped count must never break the flow.
  const count = useCallback(
    (kind: 'selfieStart' | 'preview' | 'bookingClick') => {
      void recordEvent({ slug: barberSlug, kind }).catch(() => {});
    },
    [recordEvent, barberSlug],
  );

  // Best-effort GPU pre-warm, throttled so re-edits don't hammer the endpoint
  // (it rate-limits server-side anyway; this just avoids pointless calls).
  const lastWarmupRef = useRef(0);
  const warmUp = useCallback(() => {
    const now = Date.now();
    if (now - lastWarmupRef.current < 30_000) return;
    lastWarmupRef.current = now;
    void fetch('/api/facelift/warmup', { method: 'POST' }).catch(() => {});
  }, []);

  const claimRenderStation = useCallback(async () => {
    try {
      const claim = await claimStation({ sessionId: sessionIdRef.current });
      stationJobIdRef.current = claim.jobId;
      setStationJobId(claim.jobId);
      if (stationHeartbeatRef.current) clearInterval(stationHeartbeatRef.current);
      stationHeartbeatRef.current = setInterval(() => {
        const id = stationJobIdRef.current;
        if (id) void heartbeatStation({ jobId: id }).catch(() => {});
      }, 3000);
    } catch { /* queue UI is a nicety, never block the render on it */ }
  }, [claimStation, heartbeatStation]);

  const releaseRenderStation = useCallback(() => {
    if (stationHeartbeatRef.current) { clearInterval(stationHeartbeatRef.current); stationHeartbeatRef.current = null; }
    const id = stationJobIdRef.current;
    if (id) {
      stationJobIdRef.current = null;
      void releaseStation({ jobId: id }).catch(() => {});
      setStationJobId(null);
    }
  }, [releaseStation]);

  // The real studio pipeline: gemini-hair-edit (2D) then facelift (2D → splat).
  // A facelift failure isn't fatal — the 2D image from step one stays on
  // screen so the flow never dead-ends on a GPU hiccup.
  const runPipeline = useCallback(
    async (imageUrl: string, promptText: string) => {
      setPhase('editing');
      setLastAppliedPrompt(promptText);
      setError('');
      setSceneFailed(false);
      setShowBefore(false);
      setTurntableVideoUrl(null);
      warmUp();
      try {
        const editRes = await fetch('/api/gemini-hair-edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl, prompt: promptText, sessionId: sessionIdRef.current }),
        });
        const editData = await editRes.json();
        if (!editRes.ok || !editData.ok) {
          setError(editData.error || t('That edit didn’t work — try a different photo or cut.'));
          setPhase(resultImageUrl ? 'result' : 'capture');
          return;
        }
        setResultImageUrl(editData.newImageUrl);
        setSplatSrc(null);
        setPhase('rendering');

        await claimRenderStation();
        try {
          const fingerprint = await getVisitorId();
          const faceliftRes = await fetch('/api/facelift', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageDataUrl: editData.newImageUrl, outputName: 'barber-tryon', fingerprint }),
          });
          const faceliftData = await faceliftRes.json();
          if (!faceliftRes.ok || !faceliftData.splatUrl) {
            // 2D result is already showing — surface this as a soft note, not a hard error.
            setSceneFailed(true);
            setError(faceliftData.error || t('The 3D render didn’t come through, but here’s your photo.'));
          } else {
            setSplatSrc(`/api/proxy-ply?url=${encodeURIComponent(faceliftData.splatUrl)}`);
            setTurntableVideoUrl(typeof faceliftData.videoUrl === 'string' ? faceliftData.videoUrl : null);
          }
        } finally {
          releaseRenderStation();
        }
        count('preview');
        setPhase('result');
      } catch {
        setError(t('Something went wrong. Check your connection and try again.'));
        setPhase(resultImageUrl ? 'result' : 'capture');
      }
    },
    [resultImageUrl, t, warmUp, claimRenderStation, releaseRenderStation, count],
  );

  // ── intro: "Let's see how it looks on you!" then onward ──
  const introDoneRef = useRef(false);
  useEffect(() => {
    if (phase !== 'intro' || introDoneRef.current) return;
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(() => {
      introDoneRef.current = true;
      if (sourceImageUrl) {
        // A kept selfie from an earlier cut this visit — straight to the render.
        void runPipeline(sourceImageUrl, activeCut.label);
      } else {
        setPhase('capture');
      }
    }, reduced ? 500 : 1400);
    return () => clearTimeout(timer);
  }, [phase, sourceImageUrl, activeCut.label, runPipeline]);

  // The selfie step is visible: start the GPU cold-start now, count the funnel.
  const selfieStartedRef = useRef(false);
  useEffect(() => {
    if (phase !== 'capture' || !isSignedIn) return;
    warmUp();
    if (!selfieStartedRef.current) {
      selfieStartedRef.current = true;
      count('selfieStart');
    }
  }, [phase, isSignedIn, warmUp, count]);

  // Object URL for the pending photo preview; revoked when replaced. (Guarded:
  // jsdom has no createObjectURL — the check panel just skips the thumbnail.)
  useEffect(() => {
    if (!pendingBlob || typeof URL.createObjectURL !== 'function') {
      setPendingPreview(null);
      return;
    }
    const url = URL.createObjectURL(pendingBlob);
    setPendingPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingBlob]);

  const handlePhoto = useCallback(
    async (blob: Blob) => {
      setPendingBlob(blob);
      setError('');
      setPhase('checking');
      let result: SelfieVerdict;
      try {
        result = judgeSelfie(await analyzeSelfie(blob));
      } catch {
        result = { level: 'fail', message: 'That photo didn’t load — try another one.' };
      }
      setVerdict(result);
      if (result.level === 'ok') {
        // Brief beat so "Photo looks good" registers, then continue.
        setTimeout(() => void acceptPhotoRef.current(blob), 450);
      } else {
        setPhase('confirm');
      }
    },
    [],
  );

  const acceptPhoto = useCallback(
    async (blob: Blob) => {
      setPhase('uploading');
      setError('');
      try {
        const url = await upload(blob);
        setSourceImageUrl(url);
        onSelfie?.(url);
        setPendingBlob(null);
        setVerdict(null);
        await runPipeline(url, activeCut.label);
      } catch {
        setError(t('Couldn’t upload that photo — try again.'));
        setPhase('capture');
      }
    },
    [upload, runPipeline, activeCut, onSelfie, t],
  );
  const acceptPhotoRef = useRef(acceptPhoto);
  acceptPhotoRef.current = acceptPhoto;

  const retake = useCallback(() => {
    setPendingBlob(null);
    setVerdict(null);
    setError('');
    setPhase('capture');
  }, []);

  const retakeFromResult = useCallback(() => {
    setResultImageUrl(null);
    setSplatSrc(null);
    setTurntableVideoUrl(null);
    setSceneFailed(false);
    setSourceImageUrl(null);
    setError('');
    setPhase('capture');
  }, []);

  // Re-edits start from the style shelf at the bottom of the panel — scroll
  // the result frame (where the progress overlay lives) back into view so the
  // client sees the render happening instead of a frozen grid.
  const panelRef = useRef<HTMLElement>(null);
  const scrollToTop = useCallback(() => {
    const el = panelRef.current;
    if (!el || typeof el.scrollIntoView !== 'function') return;
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }, []);

  const handleTryCut = useCallback(
    (next: Hairstyle) => {
      if (!sourceImageUrl) return;
      setActiveCut(next);
      scrollToTop();
      void runPipeline(sourceImageUrl, next.label);
    },
    [sourceImageUrl, runPipeline, scrollToTop],
  );

  const handleSubmitPrompt = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!sourceImageUrl || !prompt.trim()) return;
      void runPipeline(sourceImageUrl, prompt.trim());
    },
    [sourceImageUrl, prompt, runPipeline],
  );

  const handleSendToBarber = useCallback(async () => {
    if (!resultImageUrl) return;
    setPhase('sending');
    setSendOutcome(null);
    try {
      const imageBlob = await (await fetch(resultImageUrl)).blob();
      const hostedUrl = await upload(imageBlob);
      let hosted360Url = turntableVideoUrl ?? undefined;
      if (turntableVideoUrl) {
        try {
          const videoBlob = await (await fetch(turntableVideoUrl)).blob();
          hosted360Url = await upload(videoBlob);
        } catch {
          // The signed render URL is still useful if durable re-hosting fails.
        }
      }
      const result = await sendToBarber({
        slug: barberSlug,
        cutLabel: activeCut.label,
        imageUrl: hostedUrl,
        videoUrl: hosted360Url,
        clientRequest: prompt.trim() || lastAppliedPrompt,
        clientEmail: user?.primaryEmailAddress?.emailAddress,
        clientPhone: clientPhone.trim() || undefined,
      });
      setSendOutcome(result.ok ? (result.emailed ? 'emailed' : 'saved') : 'failed');
    } catch {
      setSendOutcome('failed');
    } finally {
      setPhase('sent');
    }
  }, [resultImageUrl, turntableVideoUrl, upload, sendToBarber, barberSlug, activeCut, prompt, lastAppliedPrompt, user, clientPhone]);

  const busy = GENERATING_PHASES.includes(phase) || phase === 'sending';
  const generating = GENERATING_PHASES.includes(phase);

  return (
    <section className="bt-panel" aria-label={t('Try it on yourself')} data-phase={phase} ref={panelRef}>
      <header className="bt-head">
        <button type="button" className="bt-back" onClick={onClose}>
          <BackIcon />
          <span className="font-sans">{t('All styles')}</span>
        </button>
        <span className="bt-cut font-mono">{activeCut.label}</span>
      </header>

      {phase === 'intro' ? (
        <div className="bt-intro" role="status">
          <img
            className="bt-intro-art"
            src={`/hair-previews/${activeCut.slug}.png`}
            alt=""
            width={132}
            height={132}
          />
          <p className="bt-intro-line">{t('Let’s see how it looks on you!')}</p>
        </div>
      ) : !isSignedIn ? (
        <div className="bt-auth">
          <p className="bt-auth-copy font-sans">
            {t('One quick sign-in — it’s how we send you the result and let this barber know what you want.')}
          </p>
          <SignUpWidget onEnter={() => {}} />
        </div>
      ) : (
        <>
          {phase === 'capture' && (
            <div className="bt-capture">
              <h3 className="bt-step-title">{t('Take a selfie')}</h3>
              <SelfieCapture onPhoto={(blob) => void handlePhoto(blob)} />
              {error && <p className="bt-error font-sans" role="alert">{error}</p>}
            </div>
          )}

          {(phase === 'checking' || phase === 'confirm') && (
            <div className="bt-check">
              {pendingPreview && (
                <div className="bt-check-frame">
                  <img src={pendingPreview} alt={t('Your photo')} />
                </div>
              )}
              {phase === 'checking' && (
                <p className="bt-check-status font-sans" role="status">
                  {verdict?.level === 'ok' ? (
                    <span className="bt-check-ok"><CheckIcon /> {t('Photo looks good')}</span>
                  ) : (
                    t('Checking your photo…')
                  )}
                </p>
              )}
              {phase === 'confirm' && verdict && (
                <>
                  <p className="bt-check-status font-sans" role="alert">{t(verdict.message)}</p>
                  <div className="bt-check-actions">
                    <button type="button" className="bt-btn" onClick={retake}>
                      {t('Retake')}
                    </button>
                    {verdict.level === 'warn' && pendingBlob && (
                      <button
                        type="button"
                        className="bt-btn is-primary"
                        onClick={() => void acceptPhoto(pendingBlob)}
                      >
                        {t('Use this photo')}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {generating && !resultImageUrl && (
            <div className="bt-loading">
              <img
                className="bt-loading-art"
                src={`/hair-previews/${activeCut.slug}.png`}
                alt=""
                width={96}
                height={96}
              />
              <StageTracker phase={phase} queuedBehind={queuedBehind} />
            </div>
          )}

          {resultImageUrl && phase !== 'capture' && (
            <div className="bt-result">
              <div className={`bt-result-frame${splatSrc && !sceneFailed ? ' is-3d' : ''}`}>
                {splatSrc && !sceneFailed && !showBefore ? (
                  <div className="bt-scene bt-scene-arrive" data-testid="tryon-scene">
                    <HairScene
                      key={sceneKey}
                      params={PLACEHOLDER_HAIR_PARAMS}
                      splatSrcOverride={splatSrc}
                      disableDefaultHairLayers
                      renderQuality="balanced"
                      background="#141416"
                    />
                    <span className="bt-scene-hint font-mono">{t('Drag to rotate · scroll to zoom')}</span>
                  </div>
                ) : (
                  <img
                    src={showBefore && sourceImageUrl ? sourceImageUrl : resultImageUrl}
                    alt={
                      showBefore
                        ? t('Your original photo')
                        : t('You, wearing {cut}', { cut: activeCut.label })
                    }
                  />
                )}
                {busy && (
                  <div className="bt-result-busy">
                    <StageTracker phase={phase} queuedBehind={queuedBehind} />
                  </div>
                )}
              </div>

              {!busy && (
                <div className="bt-view-controls" role="group" aria-label={t('View controls')}>
                  {sourceImageUrl && (
                    <button
                      type="button"
                      className={`bt-view-btn${showBefore ? ' is-on' : ''}`}
                      aria-pressed={showBefore}
                      onClick={() => setShowBefore((v) => !v)}
                    >
                      {t('Before')}
                    </button>
                  )}
                  {splatSrc && !sceneFailed && (
                    <button
                      type="button"
                      className="bt-view-btn"
                      onClick={() => { setShowBefore(false); setSceneKey((k) => k + 1); }}
                    >
                      {t('Reset view')}
                    </button>
                  )}
                  <button type="button" className="bt-view-btn" onClick={retakeFromResult}>
                    {t('Retake selfie')}
                  </button>
                </div>
              )}

              {error && <p className="bt-error font-sans" role="alert">{error}</p>}

              <form className="bt-prompt" onSubmit={handleSubmitPrompt}>
                <input
                  className="bt-prompt-input font-sans"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={t('Shorter on the sides, keep the top…')}
                  disabled={busy}
                  aria-label={t('Describe a change')}
                />
                <button type="submit" className="bt-prompt-go" disabled={busy || !prompt.trim()}>
                  {t('Go')}
                </button>
              </form>

              <div className="bt-style-browser">
                <div className="bt-style-tabs" role="tablist" aria-label={t('Hairstyle collections')}>
                  <button type="button" role="tab" aria-selected={resultShelf === 'picks'} className={resultShelf === 'picks' ? 'is-on' : ''} onClick={() => setResultShelf('picks')}>
                    {t('Barber’s picks')}
                  </button>
                  <button type="button" role="tab" aria-selected={resultShelf === 'menu'} className={resultShelf === 'menu' ? 'is-on' : ''} onClick={() => setResultShelf('menu')}>
                    {t('Menu')}
                  </button>
                </div>
                <div className="bt-style-grid" role="tabpanel">
                  {(resultShelf === 'picks' ? barberPicks : menuCuts).map((other) => (
                    <button
                      key={other.slug}
                      type="button"
                      className={`bt-menu-cut${activeCut.slug === other.slug ? ' is-current' : ''}`}
                      disabled={busy}
                      onClick={() => handleTryCut(other)}
                    >
                      <img src={`/hair-previews/${other.slug}.png`} alt="" width={88} height={88} loading="lazy" />
                      <span className="font-sans">{other.label}</span>
                    </button>
                  ))}
                  {resultShelf === 'picks' && barberPicks.length === 0 ? (
                    <p className="bt-style-empty font-sans">{t('This barber hasn’t added picks yet — explore the full menu.')}</p>
                  ) : null}
                </div>
              </div>

              <div className="bt-actions">
                {phase !== 'sent' ? (
                  <button type="button" className="bt-btn is-primary" onClick={handleSendToBarber} disabled={busy}>
                    {phase === 'sending' ? t('Sending 360…') : t('Send 360 to {name}', { name: barberName })}
                  </button>
                ) : (
                  <div className="bt-sent font-sans" role="status">
                    {sendOutcome === 'emailed' && t('Sent! They’ll see exactly what you want before you sit down.')}
                    {sendOutcome === 'saved' && t('Sent to {name}’s ShapeUp inbox — they’ll see it before your cut.', { name: barberName })}
                    {sendOutcome === 'failed' && t('Couldn’t send that — screenshot this and show them in the chair instead.')}
                  </div>
                )}
                {onBook ? (
                  <button type="button" className="bt-btn is-book" onClick={onBook}>
                    {t('Book with {name}', { name: barberName })}
                  </button>
                ) : bookingUrl ? (
                  <a
                    className="bt-btn is-book"
                    href={bookingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => count('bookingClick')}
                  >
                    {t('Book with {name}', { name: barberName })}
                  </a>
                ) : null}
              </div>

              {phase !== 'sent' && (
                <label className="bt-phone">
                  <span className="font-mono">{t('Phone (optional)')}</span>
                  <input
                    className="bt-phone-input font-sans"
                    type="tel"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    placeholder="(415) 555-0134"
                    disabled={busy}
                  />
                </label>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
