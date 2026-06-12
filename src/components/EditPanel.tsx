// ============================================================
// EditPanel — the Barber's Toolbox
// ============================================================

'use client';

import { buildCurrentProfilePayload } from '@/lib/llmPayload';
import { MAX_PROMPT_LENGTH } from '@/lib/llmValidation';
import { BarberOrder } from '@/lib/barberOrder';
import { useState, useCallback, useRef, useEffect } from 'react';
import { HairParams, UserHeadProfile } from '@/types';
import BarberOrderReceipt from '@/components/BarberOrderReceipt';

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

const PROMPT_PLACEHOLDERS = [
  '"Messy taper fade, please."',
  '"Take the sides down to a #2."',
  '"Keep the length, just add texture."',
  '"Mid fade, clean line-up."',
  '"Curly on top, skin fade sides."',
];

const PROMPT_CHIPS = [
  'low taper, textured top',
  'skin fade, keep the top',
  'buzz it — #2 all over',
  'just clean up the edges',
];

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
  const [freshCut, setFreshCut] = useState(false);

  const [agentActive, setAgentActive] = useState(false);

  const agent = useElevenLabsAgent((text) => runPromptPipeline(text));

  const [orderResult, setOrderResult] = useState<OrderResult | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

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
  void pushParams; // retained for slider/param flows

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
      setLiveStatus('3D hairstyle render is ready. Fresh cut.');
    } finally {
      // Cancel intervals immediately — don't wait for the useEffect round-trip
      if (geminiIntervalRef.current) { clearInterval(geminiIntervalRef.current); geminiIntervalRef.current = null; }
      if (hairstepIntervalRef.current) { clearInterval(hairstepIntervalRef.current); hairstepIntervalRef.current = null; }
      setPhase('idle');
      processingRef.current = false;
    }
  };

  const handleGetOrder = async () => {
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
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !data.order) {
        throw new Error(data.error ?? 'Order request failed');
      }
      setOrderResult({ order: data.order as BarberOrder, ticketNo: data.ticketNo as string, text: data.text as string });
      setLiveStatus('Barber order printed.');
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'Failed to print the order');
      setLiveStatus('Barber order failed.');
    } finally {
      setOrderLoading(false);
    }
  };

  const isBusy = phase !== 'idle';

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
        setFreshCut(true);
        const t = setTimeout(() => { setGeminiProgress(0); setHairstepProgress(0); }, 1600);
        const t2 = setTimeout(() => setFreshCut(false), 2100);
        return () => { clearTimeout(t); clearTimeout(t2); };
      }
    }
  }, [phase]);

  return (
    <aside className="relative flex flex-col gap-6 px-5 py-6 h-full overflow-y-auto cozy-scroll text-[var(--ink)]" style={{ background: 'var(--biscuit-lt)' }} aria-label="Hair editor controls">
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
      </div>

      {/* Prompt */}
      <form onSubmit={(e) => { e.preventDefault(); runPromptPipeline(prompt); setPrompt(''); }} className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <label htmlFor="hair-edit-prompt" className="pill pill-tomato">new request</label>
          <span className="font-mono text-[10px] text-[var(--smoke)]">{prompt.length}/{MAX_PROMPT_LENGTH}</span>
        </div>
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
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runPromptPipeline(prompt); setPrompt(''); }
          }}
        />
        <div id="hair-edit-prompt-chips" className="flex flex-wrap gap-1.5">
          {PROMPT_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={isBusy}
              onClick={() => setPrompt(chip)}
              className="chip-suggest disabled:opacity-40"
            >
              {chip}
            </button>
          ))}
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
                    Sketching the cut
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
                    Sculpting in 3D
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

            {/* Rotating barber chatter */}
            <p key={chatter} className="chatter-line font-serif italic text-[11.5px] text-[var(--smoke)] text-center">
              {chatter}
            </p>
          </div>
        )}
        {pipelineError && (
          <div className="px-3 py-2 rounded-lg bg-[rgba(217,78,58,0.08)] border border-[rgba(217,78,58,0.3)] text-[var(--cherry)] text-xs font-serif italic">
            {pipelineError}
          </div>
        )}
      </form>

      {/* Barber's Order */}
      <div className="flex flex-col gap-3 pt-4 border-t border-dashed border-[var(--char)]/20">
        <div className="flex items-center justify-between">
          <span className="pill pill-tomato">take it to your barber</span>
          {orderResult && !orderLoading && (
            <button
              onClick={handleGetOrder}
              aria-label="Re-print barber order with the latest cut"
              className="font-mono text-[10px] uppercase tracking-wider text-[var(--smoke)] hover:text-[var(--ink)] transition-colors"
            >
              ↻ re-print
            </button>
          )}
        </div>

        {!orderResult && !orderLoading && (
          <button
            onClick={handleGetOrder}
            aria-label="Print barber order"
            className="btn btn-cream"
            style={{ padding: '10px 16px', fontSize: 13 }}
          >
            📜 Barber&rsquo;s order
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
          <div className="px-3 py-2 rounded-lg bg-[rgba(217,78,58,0.08)] border border-[rgba(217,78,58,0.3)] text-[var(--cherry)] text-xs font-serif italic">
            {orderError} — <button onClick={handleGetOrder} className="underline">try again</button>
          </div>
        )}

        {orderResult && !orderLoading && (
          <BarberOrderReceipt order={orderResult.order} ticketNo={orderResult.ticketNo} text={orderResult.text} />
        )}
      </div>

    </aside>
  );
}
