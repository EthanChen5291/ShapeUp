// ============================================================
// EditPanel — the Barber's Toolbox
// ============================================================

'use client';

import { buildCurrentProfilePayload } from '@/lib/llmPayload';
import { getVisitorId } from '@/lib/visitorId';
import { MAX_PROMPT_LENGTH } from '@/lib/llmValidation';
import { EditReport, sanitizeEditReport } from '@/lib/editReport';
import { computeChipFlightKeyframes, CHIP_FLIGHT_OPTIONS } from './editPanelChipFlight';
import { nextSelectedChip, resolveApplyPrompt } from './editPanelChipSelection';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import { HairParams, UserHeadProfile } from '@/types';
import BarberVideoCard from '@/components/BarberVideoCard';
import { PricingPopup } from '@/components/PricingPopup';
import InferenceNote from '@/components/InferenceNote';
import HairPreviewBubble, { type CutPreview } from '@/components/HairPreviewBubble';


interface EditPanelProps {
  isMobile?: boolean;
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
  projectName?: string;
  // Barber video (360° splat clip) — capture lives in the scene; this panel
  // only triggers it and renders progress/result.
  onRequestVideo?: () => void;
  videoState?: 'idle' | 'recording' | 'encoding' | 'ready' | 'error';
  videoProgress?: number;
  videoUrl?: string | null;
  videoExt?: 'mp4' | 'webm';
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

// Trending cuts — the refresh button pages through these pools, 3 at a time.
// The gender toggle swaps which pool the chips draw from.
const TRENDING_CUTS_MENS = [
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
  'wavy perm, middle part',
  'broccoli perm, taper fade',
  'textured mod, fringe',
  'k-pop perm, curtain bangs',
  'burst fade, textured fringe',
  'bro flow, swept back',
  'twist out, taper',
  'caesar cut, textured fringe',
  'spiky eboy, mid fade',
  'perm mullet, taper fade',
];

const TRENDING_CUTS_WOMENS = [
  'long layers, curtain bangs',
  'collarbone bob, soft waves',
  'shaggy wolf cut, wispy ends',
  'blunt lob, center part',
  'butterfly layers, face framing',
  'french bob, micro fringe',
  'beachy waves, long layers',
  'pixie cut, textured crop',
  'money piece, balayage layers',
  'curly shag, volume on top',
  'sleek straight, middle part',
  'choppy bixie cut',
  'feathered layers, side bangs',
  'voluminous blowout, soft curls',
  'half-up bun, loose waves',
  'jellyfish cut, blunt crown',
  'butterfly blowout, curtain bangs',
  'birkin layers, wispy bangs',
  'italian bob, blunt ends',
  'octopus cut, choppy layers',
  'hush cut, curtain bangs',
  'C-curl perm, shoulder length',
  'spiral perm, voluminous curls',
  'soft body perm, long layers',
  'modern shag, micro bangs',
  'mixie cut, textured pixie',
];

type Gender = 'mens' | 'womens';
const TRENDING_CUTS: Record<Gender, string[]> = {
  mens: TRENDING_CUTS_MENS,
  womens: TRENDING_CUTS_WOMENS,
};

const CHIPS_PER_PAGE = 3;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

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

// Line-style scissors — inherits the surrounding text color via currentColor.
function ScissorsIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  );
}

export default function EditPanel({ isMobile = false, profile, onParamsChange, sessionId, latestImageUrl, onImageUpdated, onPlyReady, onUncertain, userCredits, paywallDisabled = false, isAllowlisted = false, projectId, projectName, onRequestVideo, videoState = 'idle', videoProgress = 0, videoUrl, videoExt = 'mp4' }: EditPanelProps) {
  const [prompt, setPrompt] = useState('');
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
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

  // Kept for the edit pipeline's report capture; consumed by future order logic.
  const [, setLastEditReport] = useState<EditReport | null>(null);

  // Trending-cut suggestion chips, paged by the refresh button.
  // The gender toggle swaps which pool we suggest from.
  const [gender, setGender] = useState<Gender>('mens');
  const [chipPoolByGender] = useState<Record<Gender, string[]>>(() => ({
    mens: shuffle(TRENDING_CUTS.mens),
    womens: shuffle(TRENDING_CUTS.womens),
  }));
  const chipPool = chipPoolByGender[gender];
  const [chipPage, setChipPage] = useState(0);
  // Hovered-chip hairstyle preview bubble (null = dismissed).
  const [chipPreview, setChipPreview] = useState<CutPreview | null>(null);
  // Mobile only: the tap-selected chip (border glows, preview pinned). Mobile
  // can't hover, so selection replaces the desktop fly-to-prompt behavior.
  const [selectedChip, setSelectedChip] = useState<string | null>(null);
  const clearChipSelection = useCallback(() => {
    setSelectedChip(null);
    setChipPreview(null);
  }, []);
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
      const fingerprint = await getVisitorId();
      const faceliftRes = await fetch('/api/facelift', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageDataUrl: newImageUrl, outputName: 'edit-output', fingerprint }),
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

  const isBusy = phase !== 'idle';

  // Submit handler: nudge the user with a fading hint when the prompt is empty
  // instead of disabling the Apply button.
  const handleApply = () => {
    if (isBusy) return;
    // On mobile a tap-selected suggestion is applied directly (no prompt box).
    const promptToApply = resolveApplyPrompt(isMobile, selectedChip, prompt);
    if (!promptToApply.trim()) {
      emptyHintTimers.current.forEach(clearTimeout);
      setEmptyHint('shown');
      emptyHintTimers.current = [
        setTimeout(() => setEmptyHint('fading'), 2700),
        setTimeout(() => setEmptyHint('hidden'), 3000),
      ];
      return;
    }
    runPromptPipeline(promptToApply);
    setPrompt('');
    clearChipSelection();
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

  // Fly a clicked suggestion chip along a quick curved arc into the prompt box,
  // then pop its text into the textarea. Falls back to a plain fill when motion
  // is reduced or the Web Animations API is unavailable (e.g. jsdom).
  const flyChipToPrompt = (chipEl: HTMLElement, chip: string) => {
    const target = promptTextareaRef.current;
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!target || reduce || typeof chipEl.animate !== 'function') {
      setPrompt(chip);
      return;
    }

    const start = chipEl.getBoundingClientRect();
    const end = target.getBoundingClientRect();

    const clone = chipEl.cloneNode(true) as HTMLElement;
    Object.assign(clone.style, {
      position: 'fixed',
      left: `${start.left}px`,
      top: `${start.top}px`,
      width: `${start.width}px`,
      height: `${start.height}px`,
      margin: '0',
      zIndex: '9999',
      pointerEvents: 'none',
      willChange: 'transform, opacity',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(clone);

    const anim = clone.animate(
      computeChipFlightKeyframes(start, end),
      CHIP_FLIGHT_OPTIONS,
    );

    anim.onfinish = () => {
      clone.remove();
      setPrompt(chip);
      // Quick pop on the textarea as the text lands.
      target.classList.remove('prompt-land');
      void target.offsetWidth;
      target.classList.add('prompt-land');
    };
  };

  const promptTextarea = (
    <textarea
      ref={promptTextareaRef}
      id="hair-edit-prompt"
      aria-describedby="hair-edit-prompt-chips"
      className={`input-soft w-full rounded-xl px-3 py-2 text-sm resize-none placeholder:text-[var(--smoke)] ${isMobile ? 'h-16' : 'h-20'}`}
      style={{ fontStyle: 'italic' }}
      placeholder={PROMPT_PLACEHOLDERS[placeholderIdx]}
      value={prompt}
      maxLength={MAX_PROMPT_LENGTH}
      onChange={(e) => setPrompt(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleApply(); }
      }}
    />
  );

  const applyButton = (
    <button
      type="submit"
      disabled={isBusy}
      aria-label="Apply hair edit request"
      className="btn btn-tomato btn-snap flex-1"
      style={{ padding: isMobile ? '10px 12px' : '14px 16px', fontSize: 14, fontWeight: 700, letterSpacing: '0.02em', borderRadius: 12 }}
    >
      {isBusy ? (
        <><span className="btn-spinner" aria-hidden />{phase === 'gemini' ? 'Styling…' : 'Rendering…'}</>
      ) : (
        <span className="inline-flex items-center gap-1.5"><ScissorsIcon />Apply</span>
      )}
    </button>
  );

  return (
    <>
    <div className={`flex-shrink-0 rounded-2xl ${isMobile ? 'overflow-visible relative' : 'overflow-hidden'}`} style={{ background: 'var(--biscuit-lt)', border: '1px solid rgba(42,32,26,0.1)', boxShadow: '0 30px 60px -24px rgba(0,0,0,0.45)' }}>
    <aside className={`relative flex flex-col text-[var(--ink)] ${isMobile ? 'gap-3 px-4 pt-8 pb-3' : 'gap-6 px-5 pt-6 pb-2'}`} aria-label="Hair editor controls">
      <div className="sr-only" aria-live="polite" aria-atomic="true">{liveStatus}</div>

      {/* FRESH CUT stamp — slams in when a render lands */}
      {freshCut && (
        <div className="stamp-fresh" aria-hidden>
          <span>FRESH CUT</span>
          <span className="stamp-fresh-sub inline-flex items-center gap-1"><ScissorsIcon size={12} /> shapeup approved</span>
        </div>
      )}

      {/* Header */}
      {isMobile ? (
        // A raised "Toolbox" tab whose top half pokes out above the card's top edge.
        <div
          className="flex items-center gap-2"
          style={{
            position: 'absolute',
            top: -19,
            left: 14,
            zIndex: 3,
            background: 'var(--chalk)',
            border: '1px solid rgba(42,32,26,0.12)',
            borderRadius: 14,
            boxShadow: '0 9px 20px -10px rgba(0,0,0,0.45)',
            padding: '8px 16px',
          }}
        >
          <span className="inline-block w-2 h-7 barber-pole" />
          <h2 className="font-display italic text-[var(--ink)] leading-none" style={{ fontWeight: 500, fontSize: '1.625rem' }}>Toolbox</h2>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="inline-block w-2 h-7 barber-pole" />
          <div>
            <div className="font-sans text-[10px] uppercase tracking-wider text-[var(--smoke)]">The barber&rsquo;s</div>
            <h2 className="font-display italic text-2xl text-[var(--ink)] leading-none" style={{ fontWeight: 500 }}>Toolbox</h2>
          </div>
          <span className={`tb-status ml-auto ${isBusy || videoState === 'recording' || videoState === 'encoding' ? 'tb-status-busy' : 'tb-status-open'}`}>
            <span className="tb-status-dot" />
            {isBusy ? 'cutting' : (videoState === 'recording' || videoState === 'encoding') ? 'filming' : 'open'}
          </span>
        </div>
      )}

      {/* Prompt */}
      <form onSubmit={(e) => { e.preventDefault(); handleApply(); }} className={`flex flex-col ${isMobile ? 'gap-2' : 'gap-3'}`}>
        {!isMobile && (
          <div className="flex items-center justify-between">
            <label htmlFor="hair-edit-prompt" className="pill pill-tomato">new request</label>
            <span className="font-mono text-[10px] text-[var(--smoke)]">{prompt.length}/{MAX_PROMPT_LENGTH}</span>
          </div>
        )}
        {isMobile ? (
          <div className="flex gap-2 items-stretch">
            <div className="prompt-frame" style={{ flex: '0 0 50%', minWidth: 0 }}>
              {promptTextarea}
            </div>
            {applyButton}
          </div>
        ) : (
          <div className="prompt-frame">
            {promptTextarea}
          </div>
        )}
        <div id="hair-edit-prompt-chips" className="flex items-start gap-1.5">
          <div key={chipPage} className="flex flex-wrap gap-1.5 flex-1 min-w-0">
            {chips.map((chip, i) => {
              const showPreview = (el: HTMLElement) => {
                const r = el.getBoundingClientRect();
                setChipPreview({ label: chip, left: r.left, right: r.right, centerY: r.top + r.height / 2 });
              };
              const isSelected = isMobile && selectedChip === chip;
              return (
                <button
                  key={chip}
                  type="button"
                  aria-pressed={isMobile ? isSelected : undefined}
                  // Mobile: tap to select (glow border + pinned preview), tap
                  // again to un-select. Desktop: fly the chip into the prompt box.
                  onClick={isMobile
                    ? (e) => {
                        const next = nextSelectedChip(selectedChip, chip);
                        setSelectedChip(next);
                        if (next) showPreview(e.currentTarget); else setChipPreview(null);
                      }
                    : (e) => flyChipToPrompt(e.currentTarget, chip)}
                  // Hover preview is desktop-only — mobile can't hover.
                  onMouseEnter={isMobile ? undefined : (e) => showPreview(e.currentTarget)}
                  onMouseLeave={isMobile ? undefined : () => setChipPreview(null)}
                  onFocus={isMobile ? undefined : (e) => showPreview(e.currentTarget)}
                  onBlur={isMobile ? undefined : () => setChipPreview(null)}
                  className={`chip-suggest chip-pop${isSelected ? ' chip-selected' : ''}`}
                  style={{ '--ci': i } as React.CSSProperties}
                >
                  {chip}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => { setChipPage(p => p + 1); clearChipSelection(); }}
              className="chip-refresh"
              aria-label={`Show more trending ${gender === 'mens' ? "men's" : "women's"} cuts`}
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
            <button
              type="button"
              onClick={() => { setGender(g => (g === 'mens' ? 'womens' : 'mens')); setChipPage(0); clearChipSelection(); }}
              className="chip-gender chip-gender-nudge"
              aria-label={`Showing ${gender === 'mens' ? "men's" : "women's"} cuts — tap to switch to ${gender === 'mens' ? "women's" : "men's"} styles`}
              title={`Showing ${gender === 'mens' ? "men's" : "women's"} styles — tap to switch`}
              /* outline + icon share one color: muted blue for men, muted pink for women */
              style={{ color: gender === 'mens' ? '#6d8bb0' : '#c97f95', borderColor: 'currentColor' }}
            >
              {gender === 'mens' ? (
                /* Mars (muted blue) — men's styles are showing */
                <svg
                  key="mens"
                  width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden
                >
                  <circle cx="9.5" cy="14.5" r="5" />
                  <line x1="13.5" y1="10.5" x2="20" y2="4" />
                  <polyline points="14.5 4 20 4 20 9.5" />
                </svg>
              ) : (
                /* Venus (muted pink) — women's styles are showing */
                <svg
                  key="womens"
                  width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden
                >
                  <circle cx="12" cy="8.5" r="5" />
                  <line x1="12" y1="13.5" x2="12" y2="22" />
                  <line x1="8.5" y1="19" x2="15.5" y2="19" />
                </svg>
              )}
            </button>
          </div>
        </div>
        <HairPreviewBubble preview={chipPreview} />
        <div className={isMobile ? 'contents' : 'relative flex gap-2'}>
          {!isMobile && applyButton}
          {emptyHint !== 'hidden' && (
            <div
              role="status"
              className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
              style={{
                opacity: emptyHint === 'fading' ? 0 : 1,
                transition: 'opacity 0.3s ease',
              }}
            >
              <div
                className="flex items-center justify-center gap-3 rounded-2xl px-10 py-8 text-center shadow-2xl font-sans"
                style={{ background: '#ffffff', color: 'var(--char)', width: 'min(90vw, 26rem)', fontSize: 'calc(0.875rem * 1.15)', fontWeight: 500 }}
              >
                <span aria-hidden><ScissorsIcon size={20} /></span>
                <span>
                  Enter your desired hairstyle<br />
                  in the toolbox!
                </span>
              </div>
            </div>
          )}
        </div>
        {!isMobile && <InferenceNote variant="edit" className="px-0.5" />}
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
    {/* On mobile the 360° card lives inside the same toolbox rectangle. */}
    {isMobile && (
      <BarberVideoCard
        isMobile
        onRequestVideo={onRequestVideo}
        videoState={videoState}
        videoProgress={videoProgress}
        videoUrl={videoUrl}
        videoExt={videoExt}
        projectName={projectName}
      />
    )}
    </div>

    {/* Barber video — 360° clip of the cut (desktop: its own card) */}
    {!isMobile && (
      <BarberVideoCard
        onRequestVideo={onRequestVideo}
        videoState={videoState}
        videoProgress={videoProgress}
        videoUrl={videoUrl}
        videoExt={videoExt}
        projectName={projectName}
      />
    )}

    {showPricing && (
      <PricingPopup
        onDismiss={() => setShowPricing(false)}
        returnUrl={projectId ? `/studio/${projectId}` : undefined}
      />
    )}
  </>
  );
}
