'use client';

import { buildCurrentProfilePayload } from '@/lib/llmPayload';
import { HairParams, UserHeadProfile } from '@/types';
import { useEffect, useRef, useState } from 'react';
import { useElevenLabsAgent } from '@/hooks/useElevenLabsAgent';
import { DemoFaceliftStatus } from '@/hooks/useDemoFacelift';
import HairScene from '@/components/HairScene';
import Image from 'next/image';

const DEMO_STATUS_LABEL: Record<string, string> = {
  idle:       'Setting up...',
  processing: 'Building 3D model (~2 min)',
  done:       'All ready',
  error:      'Error — check console',
};

const RENDER_LABELS = [
  'Drawing Blueprint',
  'Sketching 3D Model',
  'Admiring the curves',
  'Adjusting the lighting',
  'Washing your hair',
  'Finalizing colors',
  'Rendering in 3D',
];

interface DemoPreset {
  label: string;
  plys: string[];
}

const DEMO_PRESETS: DemoPreset[] = [
  { label: 'Original', plys: [] },
];

interface HairSceneDemoProps {
  params: HairParams;
  colorRGB?: string;
  profile: UserHeadProfile;
  splatSrcOverride?: string;
  hairstepPlyUrls: string[];
  disableDefaultHairLayers?: boolean;
}

function HairSceneDemo({ params, colorRGB, profile, splatSrcOverride, hairstepPlyUrls, disableDefaultHairLayers }: HairSceneDemoProps) {
  return (
    <HairScene
      params={params}
      colorRGB={colorRGB}
      profile={profile}
      splatSrcOverride={splatSrcOverride}
      hairstepPlyUrl={hairstepPlyUrls[0]}
      disableDefaultHairLayers={disableDefaultHairLayers}
    />
  );
}

interface HairEditLoopProps {
  sessionId: string;
  initialImageUrl: string;
  profile: UserHeadProfile;
  onRenderIn3D: (baldifiedDataUrl: string) => void;
  onHairstepPlyReady: (plyUrl: string) => void;
  demoMode?: boolean;
  baldSplatSrc?: string | null;
  originalSplatSrc?: string | null;
  demoStatus?: DemoFaceliftStatus;
  demoError?: string | null;
}

type Phase = 'idle' | 'gemini' | 'hairstep';

const PROMPT_SUGGESTIONS = [
  'taper fade with waves on top',
  'slick back, clean sides',
  'messy textured crop',
  'classic pompadour',
  'buzz cut, #2 on the sides',
  'mullet but make it polite',
];

const BARBER_CHATTER = [
  'Warming up the clippers…',
  'Stropping the razor…',
  'Putting on the good playlist…',
  'Sweeping the floor real quick…',
  'Pouring you a coffee…',
];

export default function HairEditLoop({ sessionId, initialImageUrl, profile, onRenderIn3D, onHairstepPlyReady, demoMode = false, baldSplatSrc, originalSplatSrc, demoStatus = 'idle', demoError }: HairEditLoopProps) {
  const [currentImageUrl, setCurrentImageUrl] = useState(initialImageUrl);
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [isBaldifying, setIsBaldifying] = useState(false);
  const [faceliftStatus, setFaceliftStatus] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState(0);

  const processingRef = useRef(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const isBusy = phase !== 'idle' || isBaldifying;

  const [renderSteps, setRenderSteps] = useState<string[]>([]);
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [activeStepPct, setActiveStepPct] = useState(0);
  const renderJobDoneRef = useRef(false);
  const loadingRef = useRef({ idx: 0, pct: 0 });

  useEffect(() => {
    if (!isBaldifying || renderSteps.length === 0) return;
    loadingRef.current = { idx: 0, pct: 0 };
    const INC = 1; // 1% per 100ms = 10s per step
    const interval = setInterval(() => {
      const state = loadingRef.current;
      const isLast = state.idx === renderSteps.length - 1;
      const cap = isLast && !renderJobDoneRef.current ? 95 : 100;
      const newPct = state.pct + INC;
      if (newPct >= cap) {
        if (!isLast) {
          loadingRef.current = { idx: state.idx + 1, pct: 0 };
          setActiveStepIdx(state.idx + 1);
          setActiveStepPct(0);
        } else if (renderJobDoneRef.current) {
          loadingRef.current = { ...state, pct: 100 };
          setActiveStepPct(100);
          clearInterval(interval);
        } else {
          loadingRef.current = { ...state, pct: 95 };
          setActiveStepPct(95);
        }
      } else {
        loadingRef.current = { ...state, pct: newPct };
        setActiveStepPct(newPct);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [isBaldifying, renderSteps]);

  const handleSubmitRef = useRef<(p?: string) => void>(() => {});

  const agent = useElevenLabsAgent((transcript) => {
    handleSubmitRef.current(transcript);
  });

  useEffect(() => {
    agent.start();
    return () => agent.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (promptOverride?: string) => {
    if (processingRef.current) return;
    const submittedPrompt = (promptOverride ?? prompt).trim();
    if (!submittedPrompt) return;
    if (isBusy) return;

    processingRef.current = true;
    setPipelineError(null);
    setPhase('gemini');

    try {
      const geminiRes = await fetch('/api/gemini-hair-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: currentImageUrl,
          prompt: submittedPrompt,
          sessionId,
          currentProfile: buildCurrentProfilePayload(profile),
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
        const detail = geminiData.detail ? ' — ' + geminiData.detail.slice(0, 200) : '';
        setPipelineError('Gemini failed: ' + msg + detail);
        return;
      }

      const newImageUrl = geminiData.newImageUrl;
      setCurrentImageUrl(newImageUrl);
      setPrompt('');

      setPhase('hairstep');
      const hairstepRes = await fetch('/api/hairstep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: newImageUrl,
          sessionId,
          currentProfile: buildCurrentProfilePayload(profile),
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
      onHairstepPlyReady(hairstepData.plyUrl);
    } finally {
      setPhase('idle');
      processingRef.current = false;
    }
  };

  handleSubmitRef.current = handleSubmit;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleRenderIn3D = async () => {
    if (isBusy) return;
    const shuffled = [...RENDER_LABELS].sort(() => Math.random() - 0.5);
    renderJobDoneRef.current = false;
    setRenderSteps(shuffled);
    setActiveStepIdx(0);
    setActiveStepPct(0);
    setIsBaldifying(true);
    setFaceliftStatus('Warming the clippers');
    try {
      const baldRes = await fetch('/api/baldify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: currentImageUrl,
          currentProfile: buildCurrentProfilePayload(profile),
        }),
      });
      const baldData = await baldRes.json();
      if (!baldData.baldifiedDataUrl) throw new Error(baldData.error ?? 'No image returned');

      setFaceliftStatus('Sending you to the 3D chair');
      const submitRes = await fetch('/api/facelift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageDataUrl: baldData.baldifiedDataUrl,
          currentProfile: buildCurrentProfilePayload(profile),
        }),
      });
      const submitData = await submitRes.json();
      if (!submitData.jobId) throw new Error(submitData.error ?? 'No job ID returned');

      setFaceliftStatus('Sculpting (~2 min — grab a coffee)');
      const jobId = submitData.jobId;
      while (true) {
        await new Promise(r => setTimeout(r, 5000));
        const pollRes = await fetch(`/api/facelift?jobId=${jobId}`);
        const pollData = await pollRes.json();
        if (pollData.status === 'success') {
          renderJobDoneRef.current = true;
          await new Promise(r => setTimeout(r, 1200));
          break;
        }
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

  const chatter = BARBER_CHATTER[Math.floor(Date.now() / 1600) % BARBER_CHATTER.length];

  const baldReady = baldSplatSrc != null;
  const origReady = originalSplatSrc != null;

  useEffect(() => {
    if (!demoMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const n = parseInt(e.key, 10);
      if (!isNaN(n) && n >= 0 && n < DEMO_PRESETS.length) {
        setSelectedPreset(n);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [demoMode]);

  // ── Demo mode ────────────────────────────────────────────────────────────
  if (demoMode) {
    const demoSplatSrc = selectedPreset === 0 ? originalSplatSrc : baldSplatSrc;
    const demoHairPlys = DEMO_PRESETS[selectedPreset]?.plys ?? [];

    return (
      <main className="flex h-screen relative overflow-hidden bg-tomato-shop">
        {/* Corner wordmark */}
        <div className="absolute top-5 left-6 z-20 wordmark-stacked text-[var(--cream)]">
          <span>Shape</span>
          <span>Up</span>
        </div>

        {/* Left panel: selfie while loading, 3D scene once bald splat is ready */}
        <div className="flex-1 min-w-0 relative">
          {baldReady ? (
            <HairSceneDemo
              params={profile.currentStyle.params}
              colorRGB={profile.currentStyle.colorRGB}
              profile={profile}
              splatSrcOverride={demoSplatSrc ?? undefined}
              hairstepPlyUrls={demoHairPlys}
              disableDefaultHairLayers
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-8 p-8">
              <div className="polaroid wonky-sm-l" style={{ maxWidth: 340 }}>
                <div className="tape tape-tl" />
                <div className="tape tape-tr" />
                <div className="relative overflow-hidden rounded-sm" style={{ background: '#1c1510', aspectRatio: '1' }}>
                  <Image src={initialImageUrl} alt="Your scan" fill className="object-cover" unoptimized />
                </div>
                <div className="absolute bottom-3 left-0 right-0 text-center">
                  <span className="font-display text-[var(--char)] text-lg" style={{ fontStyle: 'italic', fontWeight: 500 }}>
                    you ✂
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-center gap-3">
                {demoStatus !== 'error' && <div className="scissor-loader" />}
                <span className="font-sans text-[11px] uppercase tracking-wider text-[var(--cream)]" style={{ opacity: 0.8 }}>
                  {DEMO_STATUS_LABEL[demoStatus]}
                </span>
                {demoStatus === 'error' && demoError && (
                  <p className="font-mono text-[10px] text-[var(--butter)] max-w-xs text-center break-words" style={{ opacity: 0.85 }}>
                    {demoError.split('\n')[0]}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Demo sidebar */}
        <aside
          className="w-72 flex-shrink-0 flex flex-col p-4 gap-4 relative overflow-hidden"
        >
          {/* Status */}
          <div
            className="rounded-xl px-3 py-2 text-center"
            style={{ background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,248,234,0.15)' }}
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--cream)]/60 mb-0.5">status</div>
            <div className="font-sans text-[12px] text-[var(--butter)]">
              {DEMO_STATUS_LABEL[demoStatus]}
            </div>
          </div>

          {/* Number pad */}
          <div
            className="flex-1 rounded-2xl p-4 flex flex-col gap-3"
            style={{ background: 'var(--biscuit-lt)', border: '1px solid rgba(42,32,26,0.1)' }}
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink)]/50 mb-1">
              hairstyle presets
            </div>

            <div className="grid grid-cols-4 gap-2">
              {DEMO_PRESETS.map((preset, i) => {
                const isDisabled = i === 0 ? !origReady : !baldReady;
                const isSelected = selectedPreset === i;
                return (
                  <button
                    key={i}
                    onClick={() => !isDisabled && setSelectedPreset(i)}
                    disabled={isDisabled}
                    title={preset.label}
                    className="rounded-lg font-mono text-[13px] font-semibold transition-all"
                    style={{
                      padding: '10px 0',
                      background: isSelected
                        ? 'var(--tomato)'
                        : 'rgba(42,32,26,0.08)',
                      color: isSelected
                        ? 'var(--cream)'
                        : isDisabled
                        ? 'rgba(42,32,26,0.25)'
                        : 'var(--ink)',
                      border: isSelected
                        ? '2px solid var(--tomato)'
                        : '2px solid transparent',
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {i}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 space-y-1">
              {DEMO_PRESETS.map((preset, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 font-mono text-[10px]"
                  style={{ color: selectedPreset === i ? 'var(--tomato)' : 'var(--ink)/40', opacity: selectedPreset === i ? 1 : 0.45 }}
                >
                  <span className="font-semibold">{i}</span>
                  <span className="uppercase tracking-wider">{preset.label}</span>
                  {i === 0 && !origReady && (
                    <span style={{ color: 'var(--butter)', opacity: 0.7 }}>· loading</span>
                  )}
                  {i > 0 && !baldReady && (
                    <span style={{ color: 'var(--butter)', opacity: 0.7 }}>· loading</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--cream)]/50">
              {sessionId.slice(0, 8).toUpperCase()}
            </span>
            <button
              onClick={() => window.location.reload()}
              className="btn-ink"
              style={{ padding: '6px 12px', fontSize: 10 }}
            >
              ✂ Start over
            </button>
          </div>
        </aside>
      </main>
    );
  }
  // ── End demo mode ────────────────────────────────────────────────────────

  return (
    <main className="relative min-h-screen bg-tomato-shop overflow-hidden">

      <section className="relative z-10 mx-auto max-w-6xl px-6 pt-16 pb-20">
        {/* Header */}
        <header className="text-center anim-fade-up">
          <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full mb-6" style={{ background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,248,234,0.2)' }}>
            <span className="font-sans text-[11px] uppercase tracking-[0.18em] text-[var(--cream)]">Step two · tell the barber</span>
          </div>
          <h1
            className="type-chonk text-[var(--cream)]"
            style={{ fontSize: 'clamp(3.5rem, 11vw, 9rem)' }}
          >
            WH<em>a</em>T&rsquo;LL
            <br />
            IT BE,{' '}
            <em style={{ color: 'var(--butter)' }}>friend?</em>
          </h1>
          <p className="mt-6 font-serif italic text-[var(--cream)] text-lg max-w-md mx-auto" style={{ opacity: 0.92 }}>
            Say it plainly. The barber&rsquo;s heard it all.
          </p>
        </header>

        {/* Layout */}
        <div className="mt-14 grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] gap-12 items-start">
          {/* Polaroid */}
          <div className="anim-fade-up delay-100">
            <div className="polaroid wonky-sm-l mx-auto max-w-[440px]">
              <div className="tape tape-tl" />
              <div className="tape tape-tr" />

              <div className="relative aspect-[3/4] overflow-hidden rounded-sm" style={{ background: '#1c1510' }}>
                <Image
                  src={currentImageUrl}
                  alt="Hair preview"
                  fill
                  className="object-cover"
                  unoptimized
                />
                {phase !== 'idle' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 anim-fade-in" style={{ background: 'rgba(28, 21, 16, 0.82)' }}>
                    <div className="scissor-loader" />
                    <span className="font-sans text-[11px] uppercase tracking-wider text-[var(--butter)]">
                      {phase === 'gemini' ? 'Scissors out' : 'Sculpting 3D'}
                    </span>
                    <span className="font-display text-[var(--cream)] text-2xl text-center px-6" style={{ fontStyle: 'italic', fontWeight: 500 }}>
                      {chatter}
                    </span>
                  </div>
                )}
              </div>

              <div className="absolute bottom-3 left-0 right-0 text-center">
                <span className="font-display text-[var(--char)] text-lg" style={{ fontStyle: 'italic', fontWeight: 500 }}>
                  your next cut ✂
                </span>
              </div>
            </div>

            <div className="mt-5 flex justify-center">
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--cream)] px-3 py-1 rounded-full" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,248,234,0.18)' }}>
                ticket · {sessionId.slice(0, 8).toUpperCase()}
              </span>
            </div>
          </div>

          {/* Consultation card */}
          <div className="anim-fade-up delay-200">
            <div className="ticket-modern ticket-on-tomato wonky-sm-r">
              <div className="flex items-center justify-between mb-4">
                <span className="pill pill-tomato">consult</span>
                <span className="font-mono text-[11px] text-[var(--smoke)]">no. 03·42</span>
              </div>

              {isBaldifying ? (
                <div className="flex flex-col gap-3 py-4">
                  <h2 className="font-display text-[var(--ink)] text-xl mb-1" style={{ fontWeight: 500, fontStyle: 'italic' }}>
                    Sculpting your look…
                  </h2>
                  {renderSteps.map((step, i) => {
                    if (i > activeStepIdx) return null;
                    const isActive = i === activeStepIdx;
                    const pct = isActive ? Math.round(activeStepPct) : 100;
                    return (
                      <div key={step} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <span className="font-serif italic text-xs" style={{ color: isActive ? 'var(--ink)' : 'var(--smoke)' }}>{step}</span>
                          <span className="font-mono text-[10px]" style={{ color: isActive ? 'var(--ink)' : 'var(--smoke)' }}>{pct}%</span>
                        </div>
                        <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--biscuit)', border: '1px solid rgba(42,32,26,0.14)' }}>
                          <div
                            className={isActive ? 'progress-bar-fill h-full rounded-full transition-[width] duration-100' : 'h-full rounded-full'}
                            style={{ width: `${pct}%`, background: isActive ? undefined : 'var(--tomato)', opacity: isActive ? 1 : 0.55 }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : phase !== 'idle' ? (
                <div className="flex items-center justify-center py-16">
                  <p className="dot-pulse font-display text-[var(--ink)] select-none" style={{ fontSize: '3.5rem', fontStyle: 'italic', fontWeight: 500, letterSpacing: '0.2em' }}>
                    <span>.</span><span>.</span><span>.</span>
                  </p>
                </div>
              ) : (<>

              <h2 className="font-display text-[var(--ink)] text-2xl mb-4" style={{ fontWeight: 500 }}>
                Tell the barber
              </h2>

              <textarea
                className="input-soft w-full px-4 py-3 text-[16px] resize-none h-28 placeholder:text-[var(--smoke)]"
                style={{ fontStyle: 'italic' }}
                placeholder='"Anything you would like us to know about you?"'
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isBusy}
              />

              <div className="mt-4">
                <div className="font-sans text-[11px] text-[var(--smoke)] uppercase tracking-wider mb-2">
                  or try one
                </div>
                <div className="flex flex-wrap gap-2">
                  {PROMPT_SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setPrompt(s)}
                      disabled={isBusy}
                      className="btn-ghost disabled:opacity-40"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {pipelineError && (
                <div className="mt-4 px-3 py-2 rounded-lg bg-[rgba(217,78,58,0.08)] border border-[rgba(217,78,58,0.3)] text-[var(--cherry)] text-sm font-serif italic">
                  <span className="font-sans text-[10px] uppercase tracking-wider mr-2 font-semibold">oops</span>
                  {pipelineError}
                </div>
              )}

              <div className="mt-6 flex justify-center">
                <button
                  onClick={handleRenderIn3D}
                  disabled={isBusy}
                  className="btn btn-tomato w-full"
                >
                  {isBaldifying ? (faceliftStatus ?? 'Processing…') : '✂ Cut it'}
                </button>
              </div>

              <div className="mt-6 pt-5 border-t border-dashed border-[var(--char)]/20">
                <ul className="space-y-1 font-mono text-[11px] text-[var(--char)]">
                  <li className="flex justify-between py-0.5">
                    <span>AI styling</span><span>on the house</span>
                  </li>
                  <li className="flex justify-between py-0.5">
                    <span>3D sculpt</span><span>free</span>
                  </li>
                  <li className="flex justify-between py-1 pt-2 border-t border-dashed border-[var(--char)]/20 font-semibold text-[var(--ink)]">
                    <span>TOTAL</span><span>$0.00</span>
                  </li>
                </ul>
              </div>
              </>)}
            </div>

            <p className="mt-5 text-center font-serif italic text-[var(--cream)] text-sm" style={{ opacity: 0.8 }}>
              The barber won&rsquo;t charge you for thinking twice.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
