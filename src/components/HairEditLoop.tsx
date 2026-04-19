'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';

interface HairEditLoopProps {
  sessionId: string;
  initialImageUrl: string;
  onRenderIn3D: (baldifiedDataUrl: string) => void;
  onHairstepPlyReady: (plyUrl: string) => void;
}

type Phase = 'idle' | 'gemini' | 'hairstep';

export default function HairEditLoop({ sessionId, initialImageUrl, onRenderIn3D, onHairstepPlyReady }: HairEditLoopProps) {
  const [currentImageUrl, setCurrentImageUrl] = useState(initialImageUrl);
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [isBaldifying, setIsBaldifying] = useState(false);
  const [faceliftStatus, setFaceliftStatus] = useState<string | null>(null);

  // Synchronous ref guard — checked BEFORE any await, immune to React batching delays
  const processingRef = useRef(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const isBusy = phase !== 'idle' || isBaldifying;

  const handleSubmit = async () => {
    console.log('[HairEditLoop] handleSubmit called — processingRef:', processingRef.current, '| phase:', phase, '| isBusy:', isBusy, '| prompt:', JSON.stringify(prompt));

    // Ref check is synchronous — blocks even if React hasn't re-rendered yet
    if (processingRef.current) {
      console.warn('[HairEditLoop] BLOCKED by processingRef — already running. Ignoring.');
      return;
    }
    if (!prompt.trim()) {
      console.warn('[HairEditLoop] BLOCKED — prompt is empty.');
      return;
    }
    if (isBusy) {
      console.warn('[HairEditLoop] BLOCKED — isBusy=true (phase=' + phase + ').');
      return;
    }

    // Lock immediately — synchronous, no await between here and the lock set
    processingRef.current = true;
    const submittedPrompt = prompt.trim();
    setPipelineError(null);
    setPhase('gemini');

    console.log('[HairEditLoop] ========== PIPELINE START ==========');
    console.log('[HairEditLoop] prompt:', submittedPrompt);
    console.log('[HairEditLoop] currentImageUrl (first 120):', currentImageUrl?.slice(0, 120) ?? 'NULL');
    console.log('[HairEditLoop] sessionId:', sessionId);

    try {
      // ── Step 1: Gemini ────────────────────────────────────────────────────
      console.log('[HairEditLoop] STEP 1 — calling /api/gemini-hair-edit...');
      let geminiRes: Response;
      try {
        geminiRes = await fetch('/api/gemini-hair-edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: currentImageUrl, prompt: submittedPrompt, sessionId }),
        });
      } catch (netErr) {
        console.error('[HairEditLoop] NETWORK ERROR calling gemini-hair-edit:', netErr);
        setPipelineError('Network error: could not reach /api/gemini-hair-edit — ' + String(netErr));
        return;
      }

      console.log('[HairEditLoop] gemini HTTP status:', geminiRes.status, geminiRes.statusText);
      const geminiRaw = await geminiRes.text();
      console.log('[HairEditLoop] gemini raw response (first 600 chars):\n', geminiRaw.slice(0, 600));

      let geminiData: { ok: boolean; newImageUrl?: string; error?: string; detail?: string };
      try {
        geminiData = JSON.parse(geminiRaw);
      } catch {
        console.error('[HairEditLoop] gemini response is NOT valid JSON — full body:', geminiRaw);
        setPipelineError('Gemini returned non-JSON (HTTP ' + geminiRes.status + '). See server logs.');
        return;
      }

      console.log('[HairEditLoop] gemini parsed response:', {
        ok: geminiData.ok,
        newImageUrl: geminiData.newImageUrl?.slice(0, 100) ?? 'MISSING',
        error: geminiData.error ?? 'none',
        detail: geminiData.detail?.slice(0, 200) ?? 'none',
      });

      if (!geminiData.ok || !geminiData.newImageUrl) {
        const msg = geminiData.error ?? 'Unknown Gemini error';
        const detail = geminiData.detail ? ' | detail: ' + geminiData.detail.slice(0, 200) : '';
        console.error('[HairEditLoop] GEMINI FAILED —', msg, detail);
        setPipelineError('Gemini failed: ' + msg + (detail || ''));
        return;
      }

      const newImageUrl = geminiData.newImageUrl;
      console.log('[HairEditLoop] GEMINI SUCCESS — newImageUrl:', newImageUrl.slice(0, 120));
      setCurrentImageUrl(newImageUrl);
      setPrompt('');

      // ── Step 2: HairStep ─────────────────────────────────────────────────
      setPhase('hairstep');
      console.log('[HairEditLoop] STEP 2 — calling /api/hairstep with newImageUrl:', newImageUrl.slice(0, 120));

      let hairstepRes: Response;
      try {
        hairstepRes = await fetch('/api/hairstep', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: newImageUrl, sessionId }),
        });
      } catch (netErr) {
        console.error('[HairEditLoop] NETWORK ERROR calling hairstep:', netErr);
        setPipelineError('Network error: could not reach /api/hairstep — ' + String(netErr));
        return;
      }

      console.log('[HairEditLoop] hairstep HTTP status:', hairstepRes.status, hairstepRes.statusText);
      const hairstepRaw = await hairstepRes.text();
      console.log('[HairEditLoop] hairstep raw response (first 400 chars):\n', hairstepRaw.slice(0, 400));

      let hairstepData: { ok: boolean; plyUrl?: string; error?: string };
      try {
        hairstepData = JSON.parse(hairstepRaw);
      } catch {
        console.error('[HairEditLoop] hairstep response is NOT valid JSON — full body:', hairstepRaw);
        setPipelineError('HairStep returned non-JSON (HTTP ' + hairstepRes.status + '). See server logs.');
        return;
      }

      console.log('[HairEditLoop] hairstep parsed:', {
        ok: hairstepData.ok,
        plyUrl: hairstepData.plyUrl?.slice(0, 100) ?? 'MISSING',
        error: hairstepData.error ?? 'none',
      });

      if (!hairstepData.ok || !hairstepData.plyUrl) {
        console.error('[HairEditLoop] HAIRSTEP FAILED —', hairstepData.error);
        setPipelineError('HairStep failed: ' + (hairstepData.error ?? 'unknown error'));
        return;
      }

      console.log('[HairEditLoop] HAIRSTEP SUCCESS — plyUrl:', hairstepData.plyUrl.slice(0, 120));
      onHairstepPlyReady(hairstepData.plyUrl);

      console.log('[HairEditLoop] ========== PIPELINE COMPLETE ==========');

    } finally {
      // Always runs — even on bare `return` statements above
      console.log('[HairEditLoop] FINALLY — resetting phase to idle, releasing processingRef');
      setPhase('idle');
      processingRef.current = false;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleRenderIn3D = async () => {
    if (isBusy) return;
    setIsBaldifying(true);
    setFaceliftStatus('Baldifying…');
    try {
      const baldRes = await fetch('/api/baldify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: currentImageUrl }),
      });
      const baldData = await baldRes.json();
      if (!baldData.baldifiedDataUrl) throw new Error(baldData.error ?? 'No image returned');

      setFaceliftStatus('Submitting 3D job…');
      const submitRes = await fetch('/api/facelift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl: baldData.baldifiedDataUrl }),
      });
      const submitData = await submitRes.json();
      if (!submitData.jobId) throw new Error(submitData.error ?? 'No job ID returned');

      setFaceliftStatus('Generating 3D model… (this takes ~2 min)');
      const jobId = submitData.jobId;
      while (true) {
        await new Promise(r => setTimeout(r, 5000));
        const pollRes = await fetch(`/api/facelift?jobId=${jobId}`);
        const pollData = await pollRes.json();
        if (pollData.status === 'success') break;
        if (pollData.status === 'error') throw new Error(pollData.error ?? 'Facelift job failed');
      }

      onRenderIn3D(baldData.baldifiedDataUrl);
    } catch (err) {
      alert('Failed to render in 3D: ' + String(err));
      setFaceliftStatus(null);
    } finally {
      setIsBaldifying(false);
    }
  };

  const submitLabel =
    phase === 'gemini' ? 'Generating hair style…' :
    phase === 'hairstep' ? 'Processing 3D hair…' :
    'Apply Changes';

  return (
    <main className="flex flex-col items-center min-h-screen bg-gray-950 text-white p-6 gap-6">
      <h1 className="text-2xl font-bold tracking-tight">ShapeUp — Hair Preview</h1>

      <div className="relative w-full max-w-md aspect-[3/4] rounded-2xl overflow-hidden border border-gray-800 shadow-xl">
        <Image
          src={currentImageUrl}
          alt="Hair preview"
          fill
          className="object-cover"
          unoptimized
        />
        {phase !== 'idle' && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3">
            <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-300">
              {phase === 'gemini' ? 'Styling your hair…' : 'Building 3D hair…'}
            </span>
          </div>
        )}
      </div>

      {pipelineError && (
        <div className="w-full max-w-md bg-red-900/60 border border-red-500 rounded-xl px-4 py-3 text-sm text-red-200 break-words">
          <span className="font-bold">Error: </span>{pipelineError}
        </div>
      )}

      <div className="w-full max-w-md flex flex-col gap-3">
        <textarea
          className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-gray-500 transition-colors"
          rows={3}
          placeholder="Describe your haircut… (e.g. taper fade with waves on top)"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isBusy}
        />

        <div className="flex gap-3">
          <button
            onClick={handleSubmit}
            disabled={isBusy || !prompt.trim()}
            className="flex-1 bg-white text-gray-950 font-semibold rounded-xl px-4 py-3 text-sm hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitLabel}
          </button>

          <button
            onClick={handleRenderIn3D}
            disabled={isBusy}
            className="flex-1 bg-gray-800 text-white font-semibold rounded-xl px-4 py-3 text-sm hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isBaldifying ? (faceliftStatus ?? 'Processing…') : 'Render in 3D'}
          </button>
        </div>
      </div>
    </main>
  );
}
