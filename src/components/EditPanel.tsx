// ============================================================
// EditPanel — the Barber's Toolbox
// ============================================================

'use client';

import { buildCurrentProfilePayload } from '@/lib/llmPayload';
import { useState, useCallback, useRef, useEffect } from 'react';
import { HairParams, UserHeadProfile } from '@/types';

import { useElevenLabsAgent } from '@/hooks/useElevenLabsAgent';
import { useLLM } from '@/hooks/useLLM';

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
      onParamsChange(next);
    },
    [history, historyIndex, onParamsChange]
  );

  const handleSlider = (key: keyof HairParams, value: number) => {
    pushParams({ ...currentParams, [key]: value });
  };

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

      // Submit to facelift
      const faceliftSubmitRes = await fetch('/api/facelift', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageDataUrl: editDataUrl }),
      });
      const faceliftSubmitRaw = await faceliftSubmitRes.text();
      let faceliftSubmit: { jobId?: string; error?: string };
      try { faceliftSubmit = JSON.parse(faceliftSubmitRaw); }
      catch {
        pipelineHadErrorRef.current = true;
        setPipelineError('Facelift submit returned non-JSON (HTTP ' + faceliftSubmitRes.status + ').');
        return;
      }
      if (!faceliftSubmit.jobId) {
        pipelineHadErrorRef.current = true;
        setPipelineError('Facelift failed to start: ' + (faceliftSubmit.error ?? 'unknown'));
        return;
      }

      // Poll until done
      const jobId = faceliftSubmit.jobId;
      let splatUrl: string | null = null;
      while (true) {
        await new Promise(r => setTimeout(r, 5000));
        const pollRes  = await fetch(`/api/facelift?jobId=${encodeURIComponent(jobId)}&outputName=edit-output`);
        const pollData = await pollRes.json() as { status: string; splatUrl?: string; error?: string };
        if (pollData.status === 'success') { splatUrl = pollData.splatUrl!; break; }
        if (pollData.status === 'error') {
          pipelineHadErrorRef.current = true;
          setPipelineError('Facelift render failed: ' + (pollData.error ?? 'unknown'));
          return;
        }
      }

      onPlyReady(`/api/proxy-ply?url=${encodeURIComponent(splatUrl!)}`);
    } finally {
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
    } catch {
      setSummary('Failed to generate summary');
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleCopySummary = () => {
    if (summary) navigator.clipboard.writeText(summary);
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
      geminiIntervalRef.current = setInterval(() => {
        setGeminiProgress(p => p < 90 ? p + 0.55 : p);
      }, 150);
    } else if (phase === 'hairstep') {
      if (geminiIntervalRef.current) { clearInterval(geminiIntervalRef.current); geminiIntervalRef.current = null; }
      setGeminiProgress(100);
      if (hairstepIntervalRef.current) clearInterval(hairstepIntervalRef.current);
      setHairstepProgress(0);
      hairstepIntervalRef.current = setInterval(() => {
        setHairstepProgress(p => p < 90 ? p + 0.15 : p);
      }, 150);
    } else if (phase === 'idle' && prev !== 'idle') {
      if (geminiIntervalRef.current) { clearInterval(geminiIntervalRef.current); geminiIntervalRef.current = null; }
      if (hairstepIntervalRef.current) { clearInterval(hairstepIntervalRef.current); hairstepIntervalRef.current = null; }
      if (pipelineHadErrorRef.current) {
        // Error: freeze bars at current position, then reset after a beat
        const t = setTimeout(() => { setGeminiProgress(0); setHairstepProgress(0); }, 2000);
        return () => clearTimeout(t);
      } else {
        // Success: complete to 100%, then reset
        setHairstepProgress(100);
        const t = setTimeout(() => { setGeminiProgress(0); setHairstepProgress(0); }, 1000);
        return () => clearTimeout(t);
      }
    }
  }, [phase]);

  return (
    <div className="flex flex-col gap-6 px-5 py-6 h-full overflow-y-auto cozy-scroll text-[var(--ink)]" style={{ background: 'var(--biscuit-lt)' }}>
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
          <span className="pill pill-tomato">new request</span>
          <span className="font-mono text-[10px] text-[var(--smoke)]">✂</span>
        </div>
        <textarea
          className="input-soft w-full rounded-xl px-3 py-2 text-sm resize-none h-20 placeholder:text-[var(--smoke)]"
          style={{ fontStyle: 'italic' }}
          placeholder='"Messy taper fade, please."'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isBusy}
            className="btn btn-tomato flex-1"
            style={{ padding: '10px 16px', fontSize: 13 }}
          >
            {phase === 'gemini' ? 'Styling…' : phase === 'hairstep' ? 'Rendering…' : '✂ Apply'}
          </button>
          <button
            type="button"
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
        {(geminiProgress > 0) && (
          <div className="flex flex-col gap-1.5 pt-1">
            <div className="flex items-center justify-between">
              <span className="font-serif italic text-xs text-[var(--smoke)]">Drawing Blueprint…</span>
              <span className="font-mono text-[10px] text-[var(--smoke)]">{Math.round(geminiProgress)}%</span>
            </div>
            <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: 'var(--biscuit)', border: '1px solid rgba(42,32,26,0.14)' }}>
              <div className="progress-bar-fill h-full rounded-full transition-[width] duration-200" style={{ width: `${geminiProgress}%` }} />
            </div>
          </div>
        )}
        {(hairstepProgress > 0) && (
          <div className="flex flex-col gap-1.5 pt-0.5">
            <div className="flex items-center justify-between">
              <span className="font-serif italic text-xs text-[var(--smoke)]">Generating 3D Model…</span>
              <span className="font-mono text-[10px] text-[var(--smoke)]">{Math.round(hairstepProgress)}%</span>
            </div>
            <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: 'var(--biscuit)', border: '1px solid rgba(42,32,26,0.14)' }}>
              <div className="progress-bar-fill h-full rounded-full transition-[width] duration-200" style={{ width: `${hairstepProgress}%` }} />
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
              className="btn-ghost"
            >
              Copy to clipboard
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
