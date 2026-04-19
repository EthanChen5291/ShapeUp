// ============================================================
// EditPanel — the Barber's Toolbox
// ============================================================

'use client';

import { buildCurrentProfilePayload } from '@/lib/llmPayload';
import { useState, useCallback, useRef } from 'react';
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
}

export default function EditPanel({ profile, onParamsChange, sessionId, latestImageUrl, onImageUpdated, onPlyReady }: EditPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [history, setHistory] = useState<HairParams[]>([profile.currentStyle.params]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const processingRef = useRef(false);
  const [phase, setPhase] = useState<'idle' | 'gemini' | 'hairstep'>('idle');
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  const [agentActive, setAgentActive] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const agent = useElevenLabsAgent((imageUrl) => setGeneratedImage(imageUrl));
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const summaryRef = useRef<HTMLTextAreaElement>(null);

  const currentParams = history[historyIndex];
  const llmPayload = buildCurrentProfilePayload(profile);
  const liveMeasurementsJson = JSON.stringify(llmPayload.measurementSnapshot, null, 2);
  const llmPayloadJson = JSON.stringify(llmPayload, null, 2);

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

  const handlePromptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (processingRef.current) return;
    if (!prompt.trim()) return;
    if (!sessionId || !latestImageUrl) {
      setPipelineError('No session or image available. Please scan first.');
      return;
    }

    processingRef.current = true;
    const submittedPrompt = prompt.trim();
    setPipelineError(null);
    setPhase('gemini');

    try {
      const geminiRes = await fetch('/api/gemini-hair-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: latestImageUrl,
          prompt: submittedPrompt,
          sessionId,
          currentProfile: buildCurrentProfilePayload({
            ...profile,
            currentStyle: { ...profile.currentStyle, params: currentParams },
          }),
        }),
      });
      const geminiRaw = await geminiRes.text();
      let geminiData: { ok: boolean; newImageUrl?: string; error?: string; detail?: string };
      try { geminiData = JSON.parse(geminiRaw); }
      catch {
        setPipelineError('Gemini returned non-JSON (HTTP ' + geminiRes.status + ').');
        return;
      }
      if (!geminiData.ok || !geminiData.newImageUrl) {
        const msg = geminiData.error ?? 'Unknown Gemini error';
        setPipelineError('Gemini failed: ' + msg);
        return;
      }
      const newImageUrl = geminiData.newImageUrl;
      onImageUpdated(newImageUrl);
      setPrompt('');

      setPhase('hairstep');
      const hairstepRes = await fetch('/api/hairstep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: newImageUrl,
          sessionId,
          currentProfile: buildCurrentProfilePayload({
            ...profile,
            currentStyle: { ...profile.currentStyle, params: currentParams },
          }),
        }),
      });
      const hairstepRaw = await hairstepRes.text();
      let hairstepData: { ok: boolean; plyUrl?: string; error?: string };
      try { hairstepData = JSON.parse(hairstepRaw); }
      catch {
        setPipelineError('HairStep returned non-JSON (HTTP ' + hairstepRes.status + ').');
        return;
      }
      if (!hairstepData.ok || !hairstepData.plyUrl) {
        setPipelineError('HairStep failed: ' + (hairstepData.error ?? 'unknown error'));
        return;
      }
      onPlyReady(hairstepData.plyUrl);
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

      {generatedImage && (
        <div className="rounded-2xl border border-[var(--char)]/10 overflow-hidden shadow-sm">
          <img src={generatedImage} alt="Generated hairstyle" className="w-full" />
        </div>
      )}

      {/* Prompt */}
      <form onSubmit={handlePromptSubmit} className="flex flex-col gap-3">
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
            {phase === 'gemini' ? 'Styling…' : phase === 'hairstep' ? 'Sculpting…' : '✂ Apply'}
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
        {pipelineError && (
          <div className="px-3 py-2 rounded-lg bg-[rgba(217,78,58,0.08)] border border-[rgba(217,78,58,0.3)] text-[var(--cherry)] text-xs font-serif italic">
            {pipelineError}
          </div>
        )}
      </form>

      {/* Undo / Redo */}
      <div className="flex gap-2">
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
      </div>

      {/* PCA sliders */}
      <div className="flex flex-col gap-4">
        <p className="text-xs text-gray-500 uppercase tracking-widest">Hair Parameters</p>

        {(
          [
            { key: 'pc1', label: 'Hair length' },
            { key: 'pc2', label: 'Width' },
            { key: 'pc3', label: 'Ponytail-ness' },
            { key: 'pc4', label: 'Density' },
            { key: 'pc5', label: 'Wavyness' },
            { key: 'pc6', label: 'Parting' },
          ] as const
        ).map(({ key, label }) => (
          <div key={key} className="flex flex-col gap-1">
            <div className="flex justify-between text-sm">
              <span>{label}</span>
              <span className="text-gray-400">{(currentParams[key] ?? 0).toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={-3}
              max={3}
              step={0.1}
              value={currentParams[key] ?? 0}
              onChange={(e) => handleSlider(key, parseFloat(e.target.value))}
              className="slider-warm w-full"
            />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 pt-4 border-t border-dashed border-[var(--char)]/20">
        <div className="flex items-baseline justify-between">
          <span className="pill pill-denim">live measurements</span>
          <span className="font-mono text-[10px] text-[var(--smoke)]">auto</span>
        </div>
        <textarea
          readOnly
          value={liveMeasurementsJson}
          className="input-soft w-full rounded-xl p-3 font-mono text-[11px] leading-snug resize-none h-40 focus:outline-none"
          style={{ fontStyle: 'normal' }}
        />
      </div>

      <div className="flex flex-col gap-2 pt-4 border-t border-dashed border-[var(--char)]/20">
        <div className="flex items-baseline justify-between">
          <span className="pill pill-denim">llm payload</span>
          <span className="font-mono text-[10px] text-[var(--smoke)]">current_profile</span>
        </div>
        <textarea
          readOnly
          value={llmPayloadJson}
          className="input-soft w-full rounded-xl p-3 font-mono text-[11px] leading-snug resize-none h-56 focus:outline-none"
          style={{ fontStyle: 'normal' }}
        />
      </div>

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

      {/* Current preset badge */}
      <div className="mt-auto pt-4 border-t border-dashed border-[var(--char)]/20 font-mono text-[10px] text-[var(--smoke)] flex items-center justify-between">
        <span>preset · <span className="text-[var(--ink)]">{profile.currentStyle.preset}</span></span>
        <span>type · <span className="text-[var(--ink)]">{profile.currentStyle.hairType}</span></span>
      </div>
    </div>
  );
}
