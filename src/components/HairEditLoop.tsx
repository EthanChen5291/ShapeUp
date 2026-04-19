'use client';

import { buildCurrentProfilePayload } from '@/lib/llmPayload';
import { UserHeadProfile } from '@/types';
import { useRef, useState } from 'react';
import Image from 'next/image';

interface HairEditLoopProps {
  sessionId: string;
  initialImageUrl: string;
  profile: UserHeadProfile;
  onRenderIn3D: (baldifiedDataUrl: string) => void;
  onHairstepPlyReady: (plyUrl: string) => void;
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

export default function HairEditLoop({ sessionId, initialImageUrl, profile, onRenderIn3D, onHairstepPlyReady }: HairEditLoopProps) {
  const [currentImageUrl, setCurrentImageUrl] = useState(initialImageUrl);
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [isBaldifying, setIsBaldifying] = useState(false);
  const [faceliftStatus, setFaceliftStatus] = useState<string | null>(null);

  const processingRef = useRef(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const isBusy = phase !== 'idle' || isBaldifying;

  const handleSubmit = async () => {
    if (processingRef.current) return;
    if (!prompt.trim()) return;
    if (isBusy) return;

    processingRef.current = true;
    const submittedPrompt = prompt.trim();
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleRenderIn3D = async () => {
    if (isBusy) return;
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
    phase === 'gemini' ? 'Styling…' :
    phase === 'hairstep' ? 'Building 3D…' :
    '✂ Cut it';

  const chatter = BARBER_CHATTER[Math.floor(Date.now() / 1600) % BARBER_CHATTER.length];

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

              <h2 className="font-display text-[var(--ink)] text-2xl mb-4" style={{ fontWeight: 500 }}>
                Tell the barber
              </h2>

              <textarea
                className="input-soft w-full px-4 py-3 text-[16px] resize-none h-28 placeholder:text-[var(--smoke)]"
                style={{ fontStyle: 'italic' }}
                placeholder='"A sharp taper fade with waves on top, please."'
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

              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  onClick={handleSubmit}
                  disabled={isBusy || !prompt.trim()}
                  className="btn btn-tomato"
                >
                  {submitLabel}
                </button>
                <button
                  onClick={handleRenderIn3D}
                  disabled={isBusy}
                  className="btn btn-denim"
                >
                  {isBaldifying ? (faceliftStatus ?? 'Processing') : '3D it'}
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
