// ============================================================
// EditPanel — the Barber's Toolbox
// ============================================================

'use client';

import { buildCurrentProfilePayload } from '@/lib/llmPayload';
import { MAX_PROMPT_LENGTH } from '@/lib/llmValidation';
import { BarberOrder, computeZoneDeltas } from '@/lib/barberOrder';
import { analyzeOrderFeasibility } from '@/lib/orderFeasibility';
import { buildClarifyQuestions, answersToStyleContext, ClarifyQuestion } from '@/lib/orderClarify';
import { EditReport, sanitizeEditReport } from '@/lib/editReport';
import { ClarifyPanel } from '@/components/ClarifyPanel';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import { HairParams, UserHeadProfile } from '@/types';
import BarberOrderReceipt from '@/components/BarberOrderReceipt';
import { PricingPopup } from '@/components/PricingPopup';


interface EditPanelProps {
  profile: UserHeadProfile;
  onParamsChange: (params: HairParams) => void;
  sessionId: string | null;
  latestImageUrl: string | null;
  onImageUpdated: (newUrl: string) => void;
  onPlyReady: (plyUrl: string, splatKey?: string) => void;
  onUncertain?: () => void;
  userCredits?: number;
  paywallDisabled?: boolean;
  isAllowlisted?: boolean;
  projectId?: string;
}

const UNCERTAIN_PATTERNS = [
  /\bi('?m| am) not sure\b/i,
  /\bi don'?t know\b/i,
  /\bno idea\b/i,
  /\bnot sure\b/i,
  /\bunsure\b/i,
  /\bmaybe\b.*\?/i,
  /\bwhatever\b/i,
  /\bsurprise me\b/i,
  /\banything\b/i,
  /\byou ('?re|are) the (barber|expert)\b/i,
  /\bup to you\b/i,
  /\bno preference\b/i,
];

const PROMPT_PLACEHOLDERS = [
  '"Messy taper fade, please."',
  '"Take the sides down to a #2."',
  '"Keep the length, just add texture."',
  '"Mid fade, clean line-up."',
  '"Curly on top, skin fade sides."',
];

// Trending cuts — the refresh button pages through this pool, 4 at a time
const TRENDING_CUTS = [
  'low taper fade, textured fringe',
  'textured crop, skin fade',
  'modern mullet, faded sides',
  'blowout taper',
  'edgar cut, high fade',
  'wolf cut, light layers',
  'curtain fringe, mid fade',
  'comma hair, low taper',
  'afro taper, sponge curls',
  'two block, soft layers',
  'slick back undercut',
  'side part pompadour',
  'french crop, hard part',
  'mid taper with waves',
  'buzz cut, clean line-up',
  'fluffy crop, low fade',
];

const CHIPS_PER_PAGE = 4;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Tiny stable hash for the order cache key
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const ORDER_CACHE_PREFIX = 'shapeup-order:';

const PIPELINE_SESSION_PREFIX = 'shapeup-pipeline:';
const PIPELINE_MAX_AGE_MS = 5 * 60 * 1000;

interface PipelineSessionState {
  phase: 'gemini' | 'hairstep';
  geminiProgress: number;
  hairstepProgress: number;
  startedAt: number;
  // Saved prompt lets us auto-restart a gemini-phase pipeline after a refresh
  prompt?: string;
}

const CHATTER: Record<'gemini' | 'hairstep', string[]> = {
  gemini: [
    'Sketching the cut…',
    'Reading your curl pattern…',
    'Combing through the details…',
    'Eyeballing the blend…',
  ],
  hairstep: [
    'Sculpting it in 3D…',
    'Setting every strand…',
    'Spinning the chair around…',
    'Holding up the mirror…',
  ],
};

interface OrderResult {
  order: BarberOrder;
  ticketNo: string;
  text: string;
}

export default function EditPanel({ profile, onParamsChange, sessionId, latestImageUrl, onImageUpdated, onPlyReady, onUncertain, userCredits, paywallDisabled = false, isAllowlisted = false, projectId }: EditPanelProps) {
  const [prompt, setPrompt] = useState('');
  // Empty-prompt hint: 'hidden' | 'shown' | 'fading'. Shows for 3s then fades out.
  const [emptyHint, setEmptyHint] = useState<'hidden' | 'shown' | 'fading'>('hidden');
  const emptyHintTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [history, setHistory] = useState<HairParams[]>([profile.currentStyle.params]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const [showPricing, setShowPricing] = useState(false);
  const processingRef = useRef(false);
  const pipelineHadErrorRef = useRef(false);
  const originalImageUrlRef = useRef<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'gemini' | 'hairstep'>('idle');
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState('');
  const [freshCut, setFreshCut] = useState(false);

  // Recovery state: true while we're polling Convex after a mid-hairstep refresh
  const [isRecovering, setIsRecovering] = useState(false);
  const recoveryStartedAtRef = useRef<number | null>(null);
  // Carries restored progress into the phase useEffect so it doesn't reset to 0
  const restoredProgressRef = useRef<{ gemini: number; hairstep: number } | null>(null);
  // Set to true on beforeunload so the finally block skips cleanup (preserving sessionStorage for recovery)
  const isUnloadingRef = useRef(false);

  const [orderResult, setOrderResult] = useState<OrderResult | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [lastEditReport, setLastEditReport] = useState<EditReport | null>(null);
  const [clarifyState, setClarifyState] = useState<{
    questions: ClarifyQuestion[];
    answers:   Record<string, string>;
  } | null>(null);

  // Trending-cut suggestion chips, paged by the refresh button
  const [chipPool] = useState(() => shuffle(TRENDING_CUTS));
  const [chipPage, setChipPage] = useState(0);
  const chips = useMemo(() => {
    const start = (chipPage * CHIPS_PER_PAGE) % chipPool.length;
    return chipPool.concat(chipPool).slice(start, start + CHIPS_PER_PAGE);
  }, [chipPool, chipPage]);

  const currentParams = history[historyIndex];

  // Only subscribed when recovering from a mid-hairstep refresh
  const latestFacelift = useQuery(
    api.facelifts.getLatestByUser,
    isRecovering ? {} : 'skip'
  );

  const pushParams = useCallback(
    (next: HairParams) => {
      const newHistory = [...history.slice(0, historyIndex + 1), next];
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      setLiveStatus(`Hair parameters updated. Top length ${next.topLength.toFixed(1)}, side length ${next.sideLength.toFixed(1)}, back length ${next.backLength.toFixed(1)}, messiness ${next.messiness.toFixed(1)}, taper ${next.taper.toFixed(1)}.`);
      onParamsChange(next);
    },
    [history, historyIndex, onParamsChange]
  );
  void pushParams; // retained for slider/param flows

  // ── Pipeline session persistence & refresh recovery ───────────────
  // On mount: restore loading UI if a pipeline was in-flight when the page refreshed.
  useEffect(() => {
    if (!projectId) return;
    const key = `${PIPELINE_SESSION_PREFIX}${projectId}`;
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      const saved = JSON.parse(raw) as PipelineSessionState;
      if (Date.now() - saved.startedAt > PIPELINE_MAX_AGE_MS) {
        sessionStorage.removeItem(key);
        return;
      }
      if (saved.phase === 'hairstep') {
        // Carry saved progress into the phase useEffect so it doesn't reset to 0
        restoredProgressRef.current = { gemini: saved.geminiProgress, hairstep: saved.hairstepProgress };
        processingRef.current = true;
        setPhase('hairstep');
        recoveryStartedAtRef.current = saved.startedAt;
        setIsRecovering(true);
        setLiveStatus('Reconnecting to your 3D render…');
      } else {
        // Gemini phase: the in-flight request died with the page and its result is gone,
        // so there's nothing to reconnect to. Restore the prompt and tell the user to retry
        // rather than leaving a spinner up with no work behind it.
        if (saved.prompt) {
          setPrompt(saved.prompt);
          setPipelineError('Your edit was interrupted by the refresh — tap send to try again.');
        }
        sessionStorage.removeItem(key);
      }
    } catch { /* corrupt entry — ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // When Convex delivers a fresh facelift result after recovery, deliver it.
  useEffect(() => {
    if (!isRecovering || !latestFacelift || recoveryStartedAtRef.current === null || !projectId) return;
    if (latestFacelift._creationTime < recoveryStartedAtRef.current) return;
    const splatUrl = `/api/proxy-ply?key=${encodeURIComponent(latestFacelift.splatS3Key)}`;
    onPlyReady(splatUrl, latestFacelift.splatS3Key);
    setLiveStatus('3D hairstyle render is ready. Fresh cut.');
    processingRef.current = false;
    setPhase('idle');
    setIsRecovering(false);
    recoveryStartedAtRef.current = null;
    sessionStorage.removeItem(`${PIPELINE_SESSION_PREFIX}${projectId}`);
  }, [latestFacelift, isRecovering, projectId, onPlyReady]);

  // Persist phase + progress to sessionStorage so a refresh can restore it.
  const pipelineSessionKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (projectId) pipelineSessionKeyRef.current = `${PIPELINE_SESSION_PREFIX}${projectId}`;
  }, [projectId]);

  // Mark unloading so the pipeline finally-block skips cleanup and sessionStorage survives the refresh.
  useEffect(() => {
    const onBeforeUnload = () => { isUnloadingRef.current = true; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const runPromptPipeline = async (submittedPrompt: string) => {
    if (processingRef.current) return;
    if (!submittedPrompt.trim()) return;

    // Gate behind paywall if out of credits
    if (!paywallDisabled && !isAllowlisted && typeof userCredits === 'number' && userCredits <= 0) {
      setShowPricing(true);
      return;
    }

    if (onUncertain && UNCERTAIN_PATTERNS.some(p => p.test(submittedPrompt))) {
      onUncertain();
    }
    if (!latestImageUrl) {
      setPipelineError('No image available. Please scan first.');
      return;
    }

    processingRef.current = true;
    pipelineHadErrorRef.current = false;
    pendingPromptRef.current = submittedPrompt;
    setPipelineError(null);
    setClarifyState(null);
    setPhase('gemini');

    // Always edit from the original selfie to prevent facial drift across iterations.
    if (!originalImageUrlRef.current) originalImageUrlRef.current = latestImageUrl;
    const imageForGemini = originalImageUrlRef.current;

    try {
      console.log('[EditPanel] submitting to gemini-hair-edit', { imageUrl: imageForGemini, sessionId, prompt: submittedPrompt });
      const geminiRes = await fetch('/api/gemini-hair-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: imageForGemini,
          prompt: submittedPrompt,
          sessionId,
          currentProfile: buildCurrentProfilePayload({
            ...profile,
            currentStyle: { ...profile.currentStyle, params: currentParams },
          }),
        }),
      });
      console.log('[EditPanel] gemini-hair-edit HTTP status:', geminiRes.status);
      const geminiRaw = await geminiRes.text();
      console.log('[EditPanel] gemini-hair-edit raw response:', geminiRaw.slice(0, 300));
      let geminiData: { ok: boolean; newImageUrl?: string; error?: string; detail?: string; editReport?: unknown };
      try { geminiData = JSON.parse(geminiRaw); }
      catch {
        pipelineHadErrorRef.current = true;
        setPipelineError('Gemini returned non-JSON (HTTP ' + geminiRes.status + ').');
        return;
      }
      if (!geminiData.ok || !geminiData.newImageUrl) {
        const msg = (geminiData.error ?? 'Unknown Gemini error') + (geminiData.detail ? ' — ' + geminiData.detail : '');
        console.error('[EditPanel] gemini-hair-edit failed:', geminiData);
        pipelineHadErrorRef.current = true;
        setPipelineError('Gemini failed: ' + msg);
        return;
      }
      const newImageUrl = geminiData.newImageUrl;
      onImageUpdated(newImageUrl);
      setLastEditReport(sanitizeEditReport(geminiData.editReport ?? null));
      setLiveStatus('Updated hairstyle image generated. Starting 3D render.');
      setPrompt('');

      setPhase('hairstep');

      // newImageUrl is already a data:image/png;base64,… URL — pass directly to facelift.
      const faceliftRes = await fetch('/api/facelift', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageDataUrl: newImageUrl, outputName: 'edit-output' }),
      });
      const faceliftRaw = await faceliftRes.text();
      let faceliftData: { splatUrl?: string; error?: string; splatS3Key?: string };
      try { faceliftData = JSON.parse(faceliftRaw); }
      catch {
        pipelineHadErrorRef.current = true;
        setPipelineError('Facelift returned non-JSON (HTTP ' + faceliftRes.status + ').');
        return;
      }
      if (!faceliftData.splatUrl) {
        if (faceliftRes.status === 402) {
          setShowPricing(true);
          return;
        }
        pipelineHadErrorRef.current = true;
        setPipelineError('Facelift failed: ' + (faceliftData.error ?? 'unknown'));
        return;
      }

      onPlyReady(`/api/proxy-ply?url=${encodeURIComponent(faceliftData.splatUrl)}`, faceliftData.splatS3Key);
      setLiveStatus('3D hairstyle render is ready. Fresh cut.');
    } catch (err) {
      if (!pipelineHadErrorRef.current) {
        pipelineHadErrorRef.current = true;
        setPipelineError('Unexpected error: ' + (err instanceof Error ? err.message : String(err)));
      }
    } finally {
      // Cancel intervals immediately — don't wait for the useEffect round-trip
      if (geminiIntervalRef.current) { clearInterval(geminiIntervalRef.current); geminiIntervalRef.current = null; }
      if (hairstepIntervalRef.current) { clearInterval(hairstepIntervalRef.current); hairstepIntervalRef.current = null; }
      // If the page is unloading (user refreshed), skip the phase reset so the sessionStorage
      // entry survives and the recovery logic can restore the loading UI on the next load.
      if (!isUnloadingRef.current) {
        setPhase('idle');
        processingRef.current = false;
      }
    }
  };

  // Cache key identifies the cut: same params + same image → same order
  const orderCacheKey = () =>
    `${ORDER_CACHE_PREFIX}${djb2(JSON.stringify(currentParams))}:${djb2(latestImageUrl ?? 'noimg')}`;

  const handleGetOrder = async (force = false, styleContext?: string[]) => {
    // Clarify gate — generate questions client-side before the first API call.
    // Skip when force-reprinting or when styleContext is already resolved.
    if (!force && styleContext === undefined) {
      const workingProfile = { ...profile, currentStyle: { ...profile.currentStyle, params: currentParams } };
      const ctx  = computeZoneDeltas(workingProfile);
      const feas = analyzeOrderFeasibility(ctx, workingProfile, lastEditReport ? { editReport: lastEditReport } : undefined);
      const questions = buildClarifyQuestions(ctx, feas, workingProfile);
      if (questions.length > 0) {
        const defaults: Record<string, string> = {};
        for (const q of questions) defaults[q.id] = q.defaultValue;
        setClarifyState({ questions, answers: defaults });
        return;
      }
    }

    const cacheKey = orderCacheKey();

    // Only use the cache when no custom answers were provided.
    if (!force && styleContext === undefined) {
      try {
        const hit = localStorage.getItem(cacheKey);
        if (hit) {
          const parsed = JSON.parse(hit) as OrderResult;
          if (parsed?.order && parsed?.ticketNo && parsed?.text) {
            setOrderError(null);
            setOrderResult(parsed);
            setLiveStatus('Barber order reprinted from your last visit.');
            return;
          }
        }
      } catch { /* corrupt cache entry — fall through to a fresh print */ }
    }

    setOrderLoading(true);
    setOrderError(null);
    try {
      const res = await fetch('/api/barber-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: buildCurrentProfilePayload({
            ...profile,
            currentStyle: { ...profile.currentStyle, params: currentParams },
          }),
          params: currentParams,
          imageUrl: latestImageUrl ?? undefined,
          styleContext: styleContext ?? [],
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !data.order) {
        throw new Error(data.error ?? 'Order request failed');
      }
      const result: OrderResult = { order: data.order as BarberOrder, ticketNo: data.ticketNo as string, text: data.text as string };
      setOrderResult(result);
      setLiveStatus('Barber order printed.');
      try {
        localStorage.setItem(cacheKey, JSON.stringify(result));
      } catch {
        // Quota — evict older orders and retry once
        try {
          Object.keys(localStorage)
            .filter(k => k.startsWith(ORDER_CACHE_PREFIX) && k !== cacheKey)
            .forEach(k => localStorage.removeItem(k));
          localStorage.setItem(cacheKey, JSON.stringify(result));
        } catch { /* storage unavailable — order still shows, just not cached */ }
      }
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'Failed to print the order');
      setLiveStatus('Barber order failed.');
    } finally {
      setOrderLoading(false);
    }
  };

  const handleClarifyConfirm = useCallback(() => {
    if (!clarifyState) return;
    const styleCtx = answersToStyleContext(clarifyState.questions, clarifyState.answers);
    setClarifyState(null);
    handleGetOrder(false, styleCtx);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clarifyState]);

  const isBusy = phase !== 'idle';

  // Submit handler: nudge the user with a fading hint when the prompt is empty
  // instead of disabling the Apply button.
  const handleApply = () => {
    if (isBusy) return;
    if (!prompt.trim()) {
      emptyHintTimers.current.forEach(clearTimeout);
      setEmptyHint('shown');
      emptyHintTimers.current = [
        setTimeout(() => setEmptyHint('fading'), 2700),
        setTimeout(() => setEmptyHint('hidden'), 3000),
      ];
      return;
    }
    runPromptPipeline(prompt);
    setPrompt('');
  };

  useEffect(() => () => emptyHintTimers.current.forEach(clearTimeout), []);

  // ── Rotating placeholder + barber chatter ─────────────────────────
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPlaceholderIdx(i => (i + 1) % PROMPT_PLACEHOLDERS.length), 4200);
    return () => clearInterval(t);
  }, []);

  const [chatterIdx, setChatterIdx] = useState(0);
  useEffect(() => {
    if (!isBusy) return;
    setChatterIdx(0);
    const t = setInterval(() => setChatterIdx(i => i + 1), 2600);
    return () => clearInterval(t);
  }, [isBusy, phase]);
  const chatterList = CHATTER[phase === 'hairstep' ? 'hairstep' : 'gemini'];
  const chatter = chatterList[chatterIdx % chatterList.length];

  const [geminiProgress, setGeminiProgress] = useState(0);
  const [hairstepProgress, setHairstepProgress] = useState(0);
  const geminiIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hairstepIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevPhaseRef = useRef<'idle' | 'gemini' | 'hairstep'>('idle');
  // Tracks the prompt currently being processed so it can be saved to sessionStorage for recovery
  const pendingPromptRef = useRef<string>('');

  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;

    // Consume any restored progress values (set before setPhase() on refresh recovery)
    const restored = restoredProgressRef.current;
    if (restored) restoredProgressRef.current = null;

    const sessionKey = pipelineSessionKeyRef.current;
    const startedAt = Date.now();

    if (phase === 'gemini') {
      if (geminiIntervalRef.current) clearInterval(geminiIntervalRef.current);
      const initGemini = restored?.gemini ?? 0;
      const initHairstep = restored?.hairstep ?? 0;
      setGeminiProgress(initGemini);
      setHairstepProgress(initHairstep);
      const savedPrompt = pendingPromptRef.current;
      if (sessionKey) {
        try { sessionStorage.setItem(sessionKey, JSON.stringify({ phase: 'gemini', geminiProgress: initGemini, hairstepProgress: initHairstep, startedAt, prompt: savedPrompt } satisfies PipelineSessionState)); } catch { /* ignore */ }
      }
      // 400ms ticks, 2% per tick → ~88% over ~17.6s with 1.4s CSS ease-out transition for silk-smooth animation
      geminiIntervalRef.current = setInterval(() => {
        setGeminiProgress(p => {
          const next = p < 88 ? p + 2 : p;
          if (sessionKey) {
            try { sessionStorage.setItem(sessionKey, JSON.stringify({ phase: 'gemini', geminiProgress: next, hairstepProgress: 0, startedAt, prompt: savedPrompt } satisfies PipelineSessionState)); } catch { /* ignore */ }
          }
          return next;
        });
      }, 400);
    } else if (phase === 'hairstep') {
      if (geminiIntervalRef.current) { clearInterval(geminiIntervalRef.current); geminiIntervalRef.current = null; }
      setGeminiProgress(100);
      if (hairstepIntervalRef.current) clearInterval(hairstepIntervalRef.current);
      const initHairstep = restored?.hairstep ?? 0;
      setHairstepProgress(initHairstep);
      // Use the startedAt already in sessionStorage if recovering (don't overwrite it)
      if (sessionKey && !restored) {
        try { sessionStorage.setItem(sessionKey, JSON.stringify({ phase: 'hairstep', geminiProgress: 100, hairstepProgress: initHairstep, startedAt } satisfies PipelineSessionState)); } catch { /* ignore */ }
      }
      // 800ms ticks, 0.8% per tick → ~84% over ~84s; facelift typically 20–60s so bar is mid-range when done
      hairstepIntervalRef.current = setInterval(() => {
        setHairstepProgress(p => {
          const next = p < 84 ? p + 0.8 : p;
          if (sessionKey) {
            try {
              const raw = sessionStorage.getItem(sessionKey);
              const prev2 = raw ? (JSON.parse(raw) as PipelineSessionState) : null;
              sessionStorage.setItem(sessionKey, JSON.stringify({ phase: 'hairstep', geminiProgress: 100, hairstepProgress: next, startedAt: prev2?.startedAt ?? startedAt } satisfies PipelineSessionState));
            } catch { /* ignore */ }
          }
          return next;
        });
      }, 800);
    } else if (phase === 'idle' && prev !== 'idle') {
      // Intervals were already killed in the finally block; kill again defensively
      if (geminiIntervalRef.current) { clearInterval(geminiIntervalRef.current); geminiIntervalRef.current = null; }
      if (hairstepIntervalRef.current) { clearInterval(hairstepIntervalRef.current); hairstepIntervalRef.current = null; }
      if (sessionKey) {
        try { sessionStorage.removeItem(sessionKey); } catch { /* ignore */ }
      }
      if (pipelineHadErrorRef.current) {
        const t = setTimeout(() => { setGeminiProgress(0); setHairstepProgress(0); }, 2200);
        return () => clearTimeout(t);
      } else {
        // Both bars complete simultaneously when facelift output arrives
        setGeminiProgress(100);
        setHairstepProgress(100);
        setFreshCut(true);
        const t = setTimeout(() => { setGeminiProgress(0); setHairstepProgress(0); }, 1600);
        const t2 = setTimeout(() => setFreshCut(false), 2100);
        return () => { clearTimeout(t); clearTimeout(t2); };
      }
    }
  }, [phase]);

  return (
    <>
    <div className="flex-shrink-0 overflow-hidden rounded-2xl" style={{ background: 'var(--biscuit-lt)', border: '1px solid rgba(42,32,26,0.1)', boxShadow: '0 30px 60px -24px rgba(0,0,0,0.45)' }}>
    <aside className="relative flex flex-col gap-6 px-5 py-6 text-[var(--ink)]" aria-label="Hair editor controls">
      <div className="sr-only" aria-live="polite" aria-atomic="true">{liveStatus}</div>

      {/* FRESH CUT stamp — slams in when a render lands */}
      {freshCut && (
        <div className="stamp-fresh" aria-hidden>
          <span>FRESH CUT</span>
          <span className="stamp-fresh-sub">✂ shapeup approved</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="inline-block w-2 h-7 barber-pole" />
        <div>
          <div className="font-sans text-[10px] uppercase tracking-wider text-[var(--smoke)]">The barber&rsquo;s</div>
          <h2 className="font-display italic text-2xl text-[var(--ink)] leading-none" style={{ fontWeight: 500 }}>Toolbox</h2>
        </div>
        <span className={`tb-status ml-auto ${isBusy || orderLoading ? 'tb-status-busy' : 'tb-status-open'}`}>
          <span className="tb-status-dot" />
          {isBusy ? 'cutting' : orderLoading ? 'printing' : 'open'}
        </span>
      </div>

      {/* Prompt */}
      <form onSubmit={(e) => { e.preventDefault(); handleApply(); }} className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <label htmlFor="hair-edit-prompt" className="pill pill-tomato">new request</label>
          <span className="font-mono text-[10px] text-[var(--smoke)]">{prompt.length}/{MAX_PROMPT_LENGTH}</span>
        </div>
        <div className="prompt-frame">
          <textarea
            id="hair-edit-prompt"
            aria-describedby="hair-edit-prompt-chips"
            className="input-soft w-full rounded-xl px-3 py-2 text-sm resize-none h-20 placeholder:text-[var(--smoke)]"
            style={{ fontStyle: 'italic' }}
            placeholder={PROMPT_PLACEHOLDERS[placeholderIdx]}
            value={prompt}
            maxLength={MAX_PROMPT_LENGTH}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleApply(); }
            }}
          />
        </div>
        <div id="hair-edit-prompt-chips" className="flex items-start gap-1.5">
          <div key={chipPage} className="flex flex-wrap gap-1.5 flex-1 min-w-0">
            {chips.map((chip, i) => (
              <button
                key={chip}
                type="button"
                disabled={isBusy}
                onClick={() => setPrompt(chip)}
                className="chip-suggest chip-pop disabled:opacity-40"
                style={{ '--ci': i } as React.CSSProperties}
              >
                {chip}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => setChipPage(p => p + 1)}
            className="chip-refresh disabled:opacity-40"
            aria-label="Show more trending cuts"
            title="More trending cuts"
          >
            <svg
              key={chipPage}
              className={chipPage > 0 ? 'chip-refresh-spin' : undefined}
              width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
        </div>
        <div className="relative flex gap-2">
          <button
            type="submit"
            disabled={isBusy}
            aria-label="Apply hair edit request"
            className="btn btn-tomato btn-snap flex-1"
            style={{ padding: '14px 16px', fontSize: 14, fontWeight: 700, letterSpacing: '0.02em', borderRadius: 12 }}
          >
            {isBusy ? (
              <><span className="btn-spinner" aria-hidden />{phase === 'gemini' ? 'Styling…' : 'Rendering…'}</>
            ) : (
              '✂ Apply'
            )}
          </button>
          {emptyHint !== 'hidden' && (
            <div
              role="status"
              className="absolute left-0 right-0 -top-2 -translate-y-full z-20 flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm shadow-lg pointer-events-none"
              style={{
                background: 'var(--ink)',
                color: 'var(--cream)',
                opacity: emptyHint === 'fading' ? 0 : 1,
                transition: 'opacity 0.3s ease',
              }}
            >
              <span>✂</span>
              <span>Enter your desired hairstyle in the toolbox!</span>
            </div>
          )}
        </div>
        <div className={`pipeline-collapse ${isBusy ? 'pipeline-collapse-open' : ''}`} aria-hidden={!isBusy}>
          <div className="pipeline-collapse-inner">
          <div
            className="pipeline-wrapper"
            role="status"
            aria-live="polite"
            aria-label={phase === 'gemini' ? 'Sketching hair edit' : 'Rendering hairstyle in 3D'}
          >
            {/* Stage 1 — Blueprint (Gemini) */}
            <div className="pipeline-stage">
              <div className="pipeline-stage-header">
                <div className="flex items-center gap-2">
                  <span className={`stage-pip ${
                    geminiProgress >= 100
                      ? 'stage-pip-done'
                      : phase === 'gemini'
                        ? 'stage-pip-active stage-pip-blueprint'
                        : 'stage-pip-idle'
                  }`} />
                  <span className={`font-serif italic text-xs ${phase === 'gemini' ? 'text-[var(--ink)]' : 'text-[var(--smoke)]'}`}>
                    Sketching the cut
                  </span>
                </div>
                <span className="font-mono text-[10px] text-[var(--smoke)]">
                  {geminiProgress >= 100 ? '✓' : geminiProgress < 1 ? '—' : `${Math.round(geminiProgress)}%`}
                </span>
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-label="Sketching the cut progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(geminiProgress)}
              >
                <div
                  className="progress-fill progress-fill-blueprint"
                  style={{ width: `${geminiProgress}%` }}
                >
                  {geminiProgress > 0 && geminiProgress < 100 && (
                    <div className="progress-shimmer" aria-hidden />
                  )}
                </div>
              </div>
            </div>

            {/* Stage 2 — 3D Model (Facelift) */}
            <div className="pipeline-stage">
              <div className="pipeline-stage-header">
                <div className="flex items-center gap-2">
                  <span className={`stage-pip ${
                    hairstepProgress >= 100
                      ? 'stage-pip-done'
                      : phase === 'hairstep'
                        ? 'stage-pip-active stage-pip-3d'
                        : 'stage-pip-idle'
                  }`} />
                  <span className={`font-serif italic text-xs ${phase === 'hairstep' || hairstepProgress > 0 ? 'text-[var(--ink)]' : 'text-[var(--smoke)]'}`}>
                    Sculpting in 3D
                  </span>
                </div>
                <span className="font-mono text-[10px] text-[var(--smoke)]">
                  {hairstepProgress >= 100 ? '✓' : phase === 'gemini' ? '—' : hairstepProgress < 1 ? '…' : `${Math.round(hairstepProgress)}%`}
                </span>
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-label="Sculpting in 3D progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(hairstepProgress)}
              >
                <div
                  className="progress-fill progress-fill-3d"
                  style={{ width: `${hairstepProgress}%` }}
                >
                  {hairstepProgress > 0 && hairstepProgress < 100 && (
                    <div className="progress-shimmer" aria-hidden />
                  )}
                </div>
              </div>
            </div>

            {/* Rotating barber chatter */}
            <p key={chatter} className="chatter-line font-serif italic text-[11.5px] text-[var(--smoke)] text-center">
              {chatter}
            </p>
          </div>
          </div>
        </div>
        {pipelineError && (
          <div className="error-shake px-3 py-2 rounded-lg bg-[rgba(217,78,58,0.08)] border border-[rgba(217,78,58,0.3)] text-[var(--cherry)] text-xs font-serif italic">
            <span className="font-sans text-[9px] uppercase tracking-wider mr-2 font-semibold not-italic">oops</span>
            {pipelineError}
          </div>
        )}
      </form>

    </aside>
    </div>

    {/* Barber's Order — separate card */}
    <div className="flex-shrink-0 rounded-2xl px-5 py-4 flex flex-col gap-3 mt-3" style={{ background: 'var(--biscuit-lt)', border: '1px solid rgba(42,32,26,0.1)', boxShadow: '0 30px 60px -24px rgba(0,0,0,0.45)' }}>
        <div className="flex items-center justify-between">
          <span className="pill pill-tomato">take it to your barber</span>
          {orderResult && !orderLoading && !clarifyState && (
            <button
              onClick={() => handleGetOrder(true)}
              aria-label="Write a fresh order for the latest cut"
              className="font-mono text-[10px] uppercase tracking-wider text-[var(--smoke)] hover:text-[var(--ink)] transition-colors"
            >
              ↻ re-print
            </button>
          )}
        </div>

        {!orderResult && !orderLoading && !clarifyState && (
          <button
            onClick={() => handleGetOrder()}
            aria-label="Write up the exact instructions to show your barber"
            className="btn-cta-order"
          >
            <span className="btn-cta-order-beta" aria-label="beta">beta</span>
            <span className="btn-cta-order-title"><span className="btn-order-icon" aria-hidden>✂</span> Show my barber</span>
            <span className="btn-cta-order-sub">this cut, written up so they nail it first try</span>
            <span className="btn-cta-order-sheen" aria-hidden />
          </button>
        )}


        {orderLoading && (
          <div className="receipt-stub" role="status" aria-label="Printing barber order">
            <div className="receipt-stub-slot" />
            <div className="receipt-stub-paper">
              <div className="receipt-stub-line w-3/4" />
              <div className="receipt-stub-line w-1/2" />
              <div className="receipt-stub-line w-2/3" />
            </div>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--smoke)] receipt-stub-label">printing the order…</span>
          </div>
        )}

        {orderError && !orderLoading && (
          <div className="error-shake px-3 py-2 rounded-lg bg-[rgba(217,78,58,0.08)] border border-[rgba(217,78,58,0.3)] text-[var(--cherry)] text-xs font-serif italic">
            <span className="font-sans text-[9px] uppercase tracking-wider mr-2 font-semibold not-italic">oops</span>
            {orderError} — <button onClick={() => handleGetOrder()} className="underline">try again</button>
          </div>
        )}

        {orderResult && !orderLoading && (
          <BarberOrderReceipt order={orderResult.order} ticketNo={orderResult.ticketNo} text={orderResult.text} />
        )}
    </div>

    {showPricing && (
      <PricingPopup
        onDismiss={() => setShowPricing(false)}
        returnUrl={projectId ? `/studio/${projectId}` : undefined}
      />
    )}

    {/* Rendered outside the aside so position:fixed escapes overflow-hidden cleanly */}
    {clarifyState && !orderLoading && (
      <ClarifyPanel
        questions={clarifyState.questions}
        answers={clarifyState.answers}
        onAnswer={(id, val) =>
          setClarifyState(prev =>
            prev ? { ...prev, answers: { ...prev.answers, [id]: val } } : null
          )
        }
        onConfirm={handleClarifyConfirm}
      />
    )}
  </>
  );
}
