// ============================================================
// EditPanel — the Barber's Toolbox
// ============================================================

'use client';

import { buildCurrentProfilePayload } from '@/lib/llmPayload';
import { MAX_PROMPT_LENGTH } from '@/lib/llmValidation';
import { useState, useCallback, useRef, useEffect } from 'react';
import { HairParams, UserHeadProfile } from '@/types';

import { useElevenLabsAgent } from '@/hooks/useElevenLabsAgent';

interface EditPanelProps {
  profile: UserHeadProfile;
  onParamsChange: (params: HairParams) => void;
  sessionId: string | null;
  latestImageUrl: string | null;
  onImageUpdated: (newUrl: string) => void;
  onPlyReady: (plyUrl: string) => void;
  onUncertain?: () => void;
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

export default function EditPanel({ profile, onParamsChange, sessionId, latestImageUrl, onImageUpdated, onPlyReady, onUncertain }: EditPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [history, setHistory] = useState<HairParams[]>([profile.currentStyle.params]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const processingRef = useRef(false);
  const pipelineHadErrorRef = useRef(false);
  const originalImageUrlRef = useRef<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'gemini' | 'hairstep'>('idle');
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState('');

  const [agentActive, setAgentActive] = useState(false);

  const agent = useElevenLabsAgent((text) => runPromptPipeline(text));
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const summaryRef = useRef<HTMLTextAreaElement>(null);

  const currentParams = history[historyIndex];

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

  const runPromptPipeline = async (submittedPrompt: string) => {
    if (processingRef.current) return;
    if (!submittedPrompt.trim()) return;
    if (onUncertain && UNCERTAIN_PATTERNS.some(p => p.test(submittedPrompt))) {
      onUncertain();
    }
    if (!sessionId || !latestImageUrl) {
      setPipelineError('No session or image available. Please scan first.');
      return;
    }

    processingRef.current = true;
    pipelineHadErrorRef.current = false;
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
      let geminiData: { ok: boolean; newImageUrl?: string; error?: string; detail?: string };
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
      setLiveStatus('Updated hairstyle image generated. Starting 3D render.');
      setPrompt('');

      setPhase('hairstep');

      // Convert Gemini-edited image URL → data URL for facelift
      const editImgRes = await fetch(newImageUrl);
      const editBlob   = await editImgRes.blob();
      const editDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(editBlob);
      });

      // Submit to facelift and wait for synchronous result
      const faceliftRes = await fetch('/api/facelift', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageDataUrl: editDataUrl, outputName: 'edit-output' }),
      });
      const faceliftRaw = await faceliftRes.text();
      let faceliftData: { splatUrl?: string; error?: string };
      try { faceliftData = JSON.parse(faceliftRaw); }
      catch {
        pipelineHadErrorRef.current = true;
        setPipelineError('Facelift returned non-JSON (HTTP ' + faceliftRes.status + ').');
        return;
      }
      if (!faceliftData.splatUrl) {
        pipelineHadErrorRef.current = true;
        setPipelineError('Facelift failed: ' + (faceliftData.error ?? 'unknown'));
        return;
      }

      onPlyReady(`/api/proxy-ply?url=${encodeURIComponent(faceliftData.splatUrl)}`);
      setLiveStatus('3D hairstyle render is ready.');
    } finally {
      // Cancel intervals immediately — don't wait for the useEffect round-trip
      if (geminiIntervalRef.current) { clearInterval(geminiIntervalRef.current); geminiIntervalRef.current = null; }
      if (hairstepIntervalRef.current) { clearInterval(hairstepIntervalRef.current); hairstepIntervalRef.current = null; }
      setPhase('idle');
      processingRef.current = false;
    }
  };

  const undo = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      onParamsChange(prev);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      onParamsChange(next);
    }
  };

  const handleGetSummary = async () => {
    setSummaryLoading(true);
    setSummary(null);
    try {
      const res = await fetch('/api/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, params: currentParams }),
      });
      const data = await res.json();
      setSummary(data.summary ?? data.error ?? 'Something went wrong');
      setLiveStatus('Barber order summary updated.');
    } catch {
      setSummary('Failed to generate summary');
      setLiveStatus('Barber order summary failed.');
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleCopySummary = () => {
    if (summary) {
      navigator.clipboard.writeText(summary);
      setLiveStatus('Barber order copied to clipboard.');
    }
  };

  const isBusy = phase !== 'idle';

  const [geminiProgress, setGeminiProgress] = useState(0);
  const [hairstepProgress, setHairstepProgress] = useState(0);
  const geminiIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hairstepIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevPhaseRef = useRef<'idle' | 'gemini' | 'hairstep'>('idle');

  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;

    if (phase === 'gemini') {
      if (geminiIntervalRef.current) clearInterval(geminiIntervalRef.current);
      setGeminiProgress(0);
      setHairstepProgress(0);
      // 400ms ticks, 2% per tick → ~88% over ~17.6s with 1.4s CSS ease-out transition for silk-smooth animation
      geminiIntervalRef.current = setInterval(() => {
        setGeminiProgress(p => p < 88 ? p + 2 : p);
      }, 400);
    } else if (phase === 'hairstep') {
      if (geminiIntervalRef.current) { clearInterval(geminiIntervalRef.current); geminiIntervalRef.current = null; }
      setGeminiProgress(100);
      if (hairstepIntervalRef.current) clearInterval(hairstepIntervalRef.current);
      setHairstepProgress(0);
      // 800ms ticks, 0.8% per tick → ~84% over ~84s; facelift typically 20–60s so bar is mid-range when done
      hairstepIntervalRef.current = setInterval(() => {
        setHairstepProgress(p => p < 84 ? p + 0.8 : p);
      }, 800);
    } else if (phase === 'idle' && prev !== 'idle') {
      // Intervals were already killed in the finally block; kill again defensively
      if (geminiIntervalRef.current) { clearInterval(geminiIntervalRef.current); geminiIntervalRef.current = null; }
      if (hairstepIntervalRef.current) { clearInterval(hairstepIntervalRef.current); hairstepIntervalRef.current = null; }
      if (pipelineHadErrorRef.current) {
        const t = setTimeout(() => { setGeminiProgress(0); setHairstepProgress(0); }, 2200);
        return () => clearTimeout(t);
      } else {
        // Both bars complete simultaneously when facelift output arrives
        setGeminiProgress(100);
        setHairstepProgress(100);
        const t = setTimeout(() => { setGeminiProgress(0); setHairstepProgress(0); }, 1600);
        return () => clearTimeout(t);
      }
    }
  }, [phase]);

  return (
    <aside className="flex flex-col gap-6 px-5 py-6 h-full overflow-y-auto cozy-scroll text-[var(--ink)]" style={{ background: 'var(--biscuit-lt)' }} aria-label="Hair editor controls">
      <div className="sr-only" aria-live="polite" aria-atomic="true">{liveStatus}</div>
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="inline-block w-2 h-7 barber-pole" />
        <div>
          <div className="font-sans text-[10px] uppercase tracking-wider text-[var(--smoke)]">The barber&rsquo;s</div>
          <h2 className="font-display italic text-2xl text-[var(--ink)] leading-none" style={{ fontWeight: 500 }}>Toolbox</h2>
        </div>
      </div>

      {/* Prompt */}
      <form onSubmit={(e) => { e.preventDefault(); runPromptPipeline(prompt); setPrompt(''); }} className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <label htmlFor="hair-edit-prompt" className="pill pill-tomato">new request</label>
          <span className="font-mono text-[10px] text-[var(--smoke)]">✂</span>
        </div>
        <textarea
          id="hair-edit-prompt"
          aria-describedby="hair-edit-prompt-limit"
          className="input-soft w-full rounded-xl px-3 py-2 text-sm resize-none h-20 placeholder:text-[var(--smoke)]"
          style={{ fontStyle: 'italic' }}
          placeholder='"Messy taper fade, please."'
          value={prompt}
          maxLength={MAX_PROMPT_LENGTH}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div id="hair-edit-prompt-limit" className="font-mono text-[10px] text-[var(--smoke)]">
          {prompt.length}/{MAX_PROMPT_LENGTH}
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isBusy}
            aria-label="Apply hair edit request"
            className="btn btn-tomato flex-1"
            style={{ padding: '10px 16px', fontSize: 13 }}
          >
            {phase === 'gemini' ? 'Styling…' : phase === 'hairstep' ? 'Rendering…' : '✂ Apply'}
          </button>
          <button
            type="button"
            aria-label={agentActive ? 'Stop voice hair edit assistant' : 'Start voice hair edit assistant'}
            onClick={() => {
              if (agentActive) { agent.stop(); setAgentActive(false); }
              else             { agent.start(); setAgentActive(true); }
            }}
            className={`btn ${agentActive ? 'btn-tomato' : 'btn-denim'}`}
            style={{ padding: '10px 14px', fontSize: 13 }}
          >
            {agentActive ? '◼ Stop' : '🎙 Voice'}
          </button>
        </div>
        {isBusy && (
          <div className="pipeline-wrapper">
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
                    Drawing Blueprint
                  </span>
                </div>
                <span className="font-mono text-[10px] text-[var(--smoke)]">
                  {geminiProgress >= 100 ? '✓' : geminiProgress < 1 ? '—' : `${Math.round(geminiProgress)}%`}
                </span>
              </div>
              <div className="progress-track">
                <div
                  className="progress-fill progress-fill-blueprint"
                  style={{ width: `${geminiProgress}%` }}
                >
                  {geminiProgress > 0 && geminiProgress < 100 && (
                    <div className="progress-shimmer" />
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
                    Sculpting 3D Model
                  </span>
                </div>
                <span className="font-mono text-[10px] text-[var(--smoke)]">
                  {hairstepProgress >= 100 ? '✓' : phase === 'gemini' ? '—' : hairstepProgress < 1 ? '…' : `${Math.round(hairstepProgress)}%`}
                </span>
              </div>
              <div className="progress-track">
                <div
                  className="progress-fill progress-fill-3d"
                  style={{ width: `${hairstepProgress}%` }}
                >
                  {hairstepProgress > 0 && hairstepProgress < 100 && (
                    <div className="progress-shimmer" />
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        {pipelineError && (
          <div className="px-3 py-2 rounded-lg bg-[rgba(217,78,58,0.08)] border border-[rgba(217,78,58,0.3)] text-[var(--cherry)] text-xs font-serif italic">
            {pipelineError}
          </div>
        )}
      </form>

      {/* Undo / Redo */}
      {/* <div className="flex gap-2">
        <button
          onClick={undo}
          disabled={historyIndex === 0}
          className="btn-ghost flex-1 disabled:opacity-40"
        >
          ← Undo
        </button>
        <button
          onClick={redo}
          disabled={historyIndex === history.length - 1}
          className="btn-ghost flex-1 disabled:opacity-40"
        >
          Redo →
        </button>
      </div> */}

      {/* Barber Summary */}
      <div className="flex flex-col gap-3 pt-4 border-t border-dashed border-[var(--char)]/20">
        <span className="pill pill-tomato">take it to your barber</span>
        <button
          onClick={handleGetSummary}
          disabled={summaryLoading}
          aria-label="Generate barber order summary"
          className="btn btn-cream"
          style={{ padding: '10px 16px', fontSize: 13 }}
        >
          {summaryLoading ? 'Writing the order…' : '📜 Barber\u2019s order'}
        </button>
        {summary && (
          <div className="flex flex-col gap-2">
            <div className="relative">
              <textarea
                ref={summaryRef}
                aria-label="Barber order summary"
                readOnly
                value={summary}
                className="input-soft w-full rounded-xl p-4 pt-5 font-serif text-[13px] leading-snug resize-none h-40 focus:outline-none"
                style={{ fontStyle: 'normal' }}
              />
              <div
                aria-hidden
                className="absolute -top-2 left-3 px-2 py-0.5 bg-[var(--tomato)] text-[var(--cream)] font-sans text-[9px] uppercase tracking-wider rounded-md"
                style={{ fontWeight: 600 }}
              >
                order
              </div>
            </div>
            <button
              onClick={handleCopySummary}
              aria-label="Copy barber order summary to clipboard"
              className="btn-ghost"
            >
              Copy to clipboard
            </button>
          </div>
        )}
      </div>

    </aside>
  );
}
