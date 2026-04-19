// ============================================================
// EditPanel — ETHAN's domain
//
// Sidebar UI for:
//   1. Manual sliders (dev/debug)
//   2. Natural language prompt → LLM edit
//   3. Undo/redo stack
// ============================================================

'use client';

import { HairParams, UserHeadProfile } from '@/types';
import { useCallback, useRef, useState } from 'react';

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

  // Pipeline state
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
    console.log('[EditPanel] handlePromptSubmit — processingRef:', processingRef.current, '| phase:', phase, '| sessionId:', sessionId, '| latestImageUrl (first 80):', latestImageUrl?.slice(0, 80) ?? 'NULL');

    if (processingRef.current) {
      console.warn('[EditPanel] BLOCKED — processingRef is true, already running');
      return;
    }
    if (!prompt.trim()) {
      console.warn('[EditPanel] BLOCKED — empty prompt');
      return;
    }
    if (!sessionId || !latestImageUrl) {
      console.error('[EditPanel] BLOCKED — missing sessionId or latestImageUrl. sessionId:', sessionId, '| latestImageUrl:', latestImageUrl);
      setPipelineError('No session or image available. Please scan first.');
      return;
    }

    processingRef.current = true;
    const submittedPrompt = prompt.trim();
    setPipelineError(null);
    setPhase('gemini');

    console.log('[EditPanel] ========== PIPELINE START ==========');
    console.log('[EditPanel] prompt:', submittedPrompt);
    console.log('[EditPanel] sessionId:', sessionId);
    console.log('[EditPanel] latestImageUrl (first 120):', latestImageUrl.slice(0, 120));

    try {
      // ── Step 1: Gemini image edit ─────────────────────────────────────────
      console.log('[EditPanel] STEP 1 — calling /api/gemini-hair-edit...');
      let geminiRes: Response;
      try {
        geminiRes = await fetch('/api/gemini-hair-edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: latestImageUrl, prompt: submittedPrompt, sessionId }),
        });
      } catch (netErr) {
        console.error('[EditPanel] NETWORK ERROR calling /api/gemini-hair-edit:', netErr);
        setPipelineError('Network error reaching /api/gemini-hair-edit: ' + String(netErr));
        return;
      }

      console.log('[EditPanel] gemini HTTP status:', geminiRes.status, geminiRes.statusText);
      const geminiRaw = await geminiRes.text();
      console.log('[EditPanel] gemini raw response (first 600 chars):\n', geminiRaw.slice(0, 600));

      let geminiData: { ok: boolean; newImageUrl?: string; error?: string; detail?: string };
      try {
        geminiData = JSON.parse(geminiRaw);
      } catch {
        console.error('[EditPanel] gemini response NOT valid JSON! Full body:', geminiRaw);
        setPipelineError('Gemini returned non-JSON (HTTP ' + geminiRes.status + '). Check server logs.');
        return;
      }

      console.log('[EditPanel] gemini parsed:', {
        ok: geminiData.ok,
        newImageUrl: geminiData.newImageUrl?.slice(0, 100) ?? 'MISSING',
        error: geminiData.error ?? 'none',
        detail: geminiData.detail?.slice(0, 200) ?? 'none',
      });

      if (!geminiData.ok || !geminiData.newImageUrl) {
        const msg = geminiData.error ?? 'Unknown Gemini error';
        const detail = geminiData.detail ? ' — ' + geminiData.detail.slice(0, 200) : '';
        console.error('[EditPanel] GEMINI FAILED:', msg, detail);
        setPipelineError('Gemini failed: ' + msg + detail);
        return;
      }

      const newImageUrl = geminiData.newImageUrl;
      console.log('[EditPanel] GEMINI SUCCESS — newImageUrl:', newImageUrl.slice(0, 120));
      onImageUpdated(newImageUrl);
      setPrompt('');

      // ── Step 2: HairStep ─────────────────────────────────────────────────
      setPhase('hairstep');
      console.log('[EditPanel] STEP 2 — calling /api/hairstep with newImageUrl:', newImageUrl.slice(0, 120));

      let hairstepRes: Response;
      try {
        hairstepRes = await fetch('/api/hairstep', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: newImageUrl, sessionId }),
        });
      } catch (netErr) {
        console.error('[EditPanel] NETWORK ERROR calling /api/hairstep:', netErr);
        setPipelineError('Network error reaching /api/hairstep: ' + String(netErr));
        return;
      }

      console.log('[EditPanel] hairstep HTTP status:', hairstepRes.status, hairstepRes.statusText);
      const hairstepRaw = await hairstepRes.text();
      console.log('[EditPanel] hairstep raw response (first 400 chars):\n', hairstepRaw.slice(0, 400));

      let hairstepData: { ok: boolean; plyUrl?: string; error?: string };
      try {
        hairstepData = JSON.parse(hairstepRaw);
      } catch {
        console.error('[EditPanel] hairstep response NOT valid JSON! Full body:', hairstepRaw);
        setPipelineError('HairStep returned non-JSON (HTTP ' + hairstepRes.status + '). Check server logs.');
        return;
      }

      console.log('[EditPanel] hairstep parsed:', {
        ok: hairstepData.ok,
        plyUrl: hairstepData.plyUrl?.slice(0, 100) ?? 'MISSING',
        error: hairstepData.error ?? 'none',
      });

      if (!hairstepData.ok || !hairstepData.plyUrl) {
        console.error('[EditPanel] HAIRSTEP FAILED:', hairstepData.error);
        setPipelineError('HairStep failed: ' + (hairstepData.error ?? 'unknown error'));
        return;
      }

      console.log('[EditPanel] HAIRSTEP SUCCESS — plyUrl:', hairstepData.plyUrl.slice(0, 120));
      onPlyReady(hairstepData.plyUrl);
      console.log('[EditPanel] ========== PIPELINE COMPLETE ==========');

    } finally {
      console.log('[EditPanel] FINALLY — resetting phase to idle, releasing processingRef');
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

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      onParamsChange(next);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-4 bg-gray-900 text-white h-full overflow-y-auto">
      <h2 className="text-lg font-semibold">Edit Hair</h2>

      {generatedImage && (
        <img src={generatedImage} alt="Generated hairstyle" className="rounded w-full" />
      )}

      {/* LLM Prompt */}
      <form onSubmit={handlePromptSubmit} className="flex flex-col gap-2">
        <label className="text-sm text-gray-400">Describe the style</label>
        <textarea
          className="bg-gray-800 rounded p-2 text-sm resize-none h-20 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder='e.g. "Give me a messy taper fade"'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={phase !== 'idle'}
            className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 rounded px-4 py-2 text-sm font-medium transition-colors"
          >
            {phase === 'gemini' ? 'Styling…' : phase === 'hairstep' ? 'Building 3D…' : 'Apply Style'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (agentActive) { agent.stop(); setAgentActive(false); }
              else             { agent.start(); setAgentActive(true); }
            }}
            className={`rounded px-3 py-2 text-sm font-medium transition-colors ${agentActive ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}
          >
            {agentActive ? '⏹ Stop' : '🎤 Voice'}
          </button>
        </div>
        {pipelineError && <p className="text-red-400 text-xs">{pipelineError}</p>}
      </form>

      {/* Undo / Redo */}
      <div className="flex gap-2">
        <button
          onClick={undo}
          disabled={historyIndex === 0}
          className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded px-3 py-1 text-sm"
        >
          ← Undo
        </button>
        <button
          onClick={redo}
          disabled={historyIndex === history.length - 1}
          className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded px-3 py-1 text-sm"
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
              className="w-full accent-blue-500"
            />
          </div>
        ))}
      </div>

      {/* Barber Summary */}
      <div className="flex flex-col gap-2 pt-4 border-t border-gray-700">
        <button
          onClick={handleGetSummary}
          disabled={summaryLoading}
          className="bg-green-700 hover:bg-green-600 disabled:bg-gray-600 rounded px-4 py-2 text-sm font-medium transition-colors"
        >
          {summaryLoading ? 'Generating…' : 'Get Barber Summary'}
        </button>
        {summary && (
          <div className="flex flex-col gap-1">
            <textarea
              ref={summaryRef}
              readOnly
              value={summary}
              className="bg-gray-800 rounded p-2 text-xs text-gray-200 resize-none h-36 focus:outline-none"
            />
            <button
              onClick={handleCopySummary}
              className="bg-gray-700 hover:bg-gray-600 rounded px-3 py-1 text-xs"
            >
              Copy to clipboard
            </button>
          </div>
        )}
      </div>

      {/* Current preset badge */}
      <div className="mt-auto pt-4 border-t border-gray-700 text-xs text-gray-400">
        Preset: <span className="text-white font-medium">{profile.currentStyle.preset}</span>
        {' · '}
        Hair type: <span className="text-white font-medium">{profile.currentStyle.hairType}</span>
      </div>
    </div>
  );
}
