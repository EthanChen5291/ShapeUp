'use client';

import { HairMeasurementBBox, HairParams, UserHeadProfile } from '@/types';
import { buildHairMeasurementSnapshot, ensureMeasurementSnapshot } from '@/lib/hairMeasurementSnapshot';
import { useCallback, useEffect, useState } from 'react';

import EditPanel from '@/components/EditPanel';
import HairEditLoop from '@/components/HairEditLoop';
import { buildCurrentProfilePayload } from '@/lib/llmPayload';
import dynamic from 'next/dynamic';
import { mockUserHeadProfile } from '@/data/mockProfile';
import { useSmirk } from '@/hooks/useSmirk';

const HairScene  = dynamic(() => import('@/components/HairScene'),  { ssr: false });
const ScanCamera = dynamic(() => import('@/components/ScanCamera'), { ssr: false });
const HairRecommendationsBar = dynamic(() => import('@/components/HairRecommendationsBar'), { ssr: false });

type AppState = 'scan' | 'hairEditLoop' | '3d';
type RawHairBBox = Omit<HairMeasurementBBox, 'width' | 'height' | 'depth'>;

export default function Home() {
  const [appState, setAppState] = useState<AppState>('scan');
  const [profile, setProfile]   = useState<UserHeadProfile | null>(null);
  const [params,  setParams]    = useState<HairParams>(mockUserHeadProfile.currentStyle.params);
  const [sessionId, setSessionId]   = useState<string | null>(null);
  const [imageUrl,  setImageUrl]    = useState<string | null>(null);
  const [baldifiedDataUrl, setBaldifiedDataUrl] = useState<string | null>(null);
  const [faceliftPlyReady, setFaceliftPlyReady] = useState(false);
  const [hairstepPlyUrl, setHairstepPlyUrl]     = useState<string | null>(null);
  const [previewPlyUrl, setPreviewPlyUrl]        = useState<string | null>(null);

  const smirk = useSmirk(profile?.faceScanData?.imageDataUrl);

  useEffect(() => {
    const imageDataUrl = profile?.faceScanData?.imageDataUrl;
    if (!sessionId || !imageDataUrl) return;
    fetch('/api/hairstep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageDataUrl,
        sessionId,
        currentProfile: buildCurrentProfilePayload(profile),
      }),
    })
      .then(r => r.json())
      .then(data => { if (data.plyUrl) setHairstepPlyUrl(`/api/proxy-ply?url=${encodeURIComponent(data.plyUrl)}`); })
      .catch(() => {});
  }, [sessionId, profile]);

  const handleParamsChange = useCallback((next: HairParams) => {
    setParams(next);
    setProfile(prev => prev ? {
      ...prev,
      currentStyle: { ...prev.currentStyle, params: next },
      measurementSnapshot: buildHairMeasurementSnapshot({
        source: 'derived_params',
        baselineMeasurements: prev.hairMeasurements,
        params: next,
        revision: (prev.measurementSnapshot?.revision ?? 0) + 1,
        bbox: prev.measurementSnapshot?.bbox,
      }),
    } : prev);
  }, []);

  const handleScanComplete = (p: UserHeadProfile, sid: string | null, url: string | null) => {
    const profileWithMeasurements = ensureMeasurementSnapshot(p);
    setProfile(profileWithMeasurements);
    setParams(profileWithMeasurements.currentStyle.params);
    if (sid && url) {
      setSessionId(sid);
      setImageUrl(url);
      setAppState('hairEditLoop');
    } else {
      setAppState('3d');
    }
  };

  const handleHairBBoxReady = useCallback((bbox: RawHairBBox) => {
    setProfile(prev => prev ? {
      ...prev,
      measurementSnapshot: buildHairMeasurementSnapshot({
        source: 'mesh_bbox',
        baselineMeasurements: prev.hairMeasurements,
        params: prev.currentStyle.params,
        revision: (prev.measurementSnapshot?.revision ?? 0) + 1,
        bbox,
      }),
    } : prev);
  }, []);

  // ─────────────────────── SCAN ───────────────────────
  if (appState === 'scan') {
    return (
      <main className="relative min-h-screen bg-tomato-shop overflow-hidden">
        {/* Hero */}
        <section className="relative z-10 mx-auto max-w-7xl px-8 pt-16 pb-8">
          <div className="relative text-center anim-fade-up">
            {/* Gigantic stacked wordmark with mascot nestled in */}
            <div className="relative inline-block">
              <h1
                className="type-chonk text-[var(--cream)] select-none"
                style={{ fontSize: 'clamp(5rem, 18vw, 16rem)' }}
              >
                SH<em>a</em>PE
                <br />
                <em>U</em>P<span className="inline-block" style={{ width: '0.18em' }} />
              </h1>

              {/* Mascot — retro barber scissors */}
              <div
                className="absolute pointer-events-none anim-fade-up delay-300"
                style={{
                  left: '-32%',
                  bottom: '-4%',
                  width: 'clamp(120px, 18vw, 240px)',
                  transform: 'rotate(186deg)',
                }}
              >
                <BarberMascot />
              </div>
            </div>

            <div className="relative mt-6 mx-auto max-w-xl">
              <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,248,234,0.2)' }}>
                <span className="dot-open" style={{ background: 'var(--butter)', boxShadow: '0 0 0 3px rgba(255,231,176,0.25)' }} />
                <span className="font-sans text-[11px] uppercase tracking-[0.18em] text-[var(--cream)]">Open · come on in</span>
              </div>
              <p className="mt-5 font-serif text-[var(--cream)] text-lg leading-snug" style={{ opacity: 0.92, fontStyle: 'italic' }}>
                A neighborhood AI barber. Scan your face, describe the cut,
                watch it land in 3D — the coffee&rsquo;s on us.
              </p>
            </div>
          </div>
        </section>

        {/* Chair — the camera */}
        <section id="chair" className="relative z-10 mx-auto max-w-5xl px-8 pb-16 pt-4">
          <div className="grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-8 items-center">
            {/* Left pull-quote */}
            <aside className="anim-fade-up delay-200 hidden md:block">
              <div className="text-[var(--cream)]">
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] opacity-70 mb-3">01 · the chair</div>
                <p className="font-display italic text-3xl leading-[1.05]" style={{ fontWeight: 500 }}>
                  &ldquo;Have a seat.
                  <br />
                  <span className="text-[var(--butter)]">I&rsquo;ll be right with&nbsp;ya.&rdquo;</span>
                </p>
                <div className="mt-3 font-sans text-[11px] uppercase tracking-[0.2em]" style={{ opacity: 0.7 }}>
                  — the barber
                </div>
              </div>
            </aside>

            {/* Center — polaroid */}
            <div className="anim-fade-up delay-100 mx-auto w-full max-w-[420px]">
              <div className="polaroid wonky-sm-l">
                <div className="tape tape-tl" />
                <div className="tape tape-tr" />

                <div className="relative overflow-hidden rounded-sm" style={{ background: '#1c1510' }}>
                  <ScanCamera
                    hairType="straight"
                    onScanComplete={handleScanComplete}
                    onDismiss={() => {
                      setProfile(mockUserHeadProfile);
                      setAppState('3d');
                    }}
                  />
                </div>

                <div className="absolute bottom-3 left-0 right-0 text-center">
                  <span className="font-display text-[var(--char)] text-lg" style={{ fontStyle: 'italic', fontWeight: 500 }}>
                    the looking glass ✂
                  </span>
                </div>
              </div>
            </div>

            {/* Right menu */}
            <aside className="anim-fade-up delay-300 hidden md:block">
              <div className="text-[var(--cream)]">
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] opacity-70 mb-3">02 · the menu</div>
                <ul className="space-y-2.5 font-serif text-[15px]">
                  {[
                    ['Mirror scan',        'free'],
                    ['AI styling',         'free'],
                    ['3D preview',         'free'],
                    ['Barber\u2019s notes', 'free'],
                    ['Second opinions',    'unlimited'],
                  ].map(([a, b]) => (
                    <li key={a} className="flex items-baseline gap-2 leading-tight">
                      <span>{a}</span>
                      <span className="flex-1 border-b border-dotted border-[var(--cream)]/40 mb-1" />
                      <span className="font-sans text-[10px] uppercase tracking-[0.18em] text-[var(--butter)]">{b}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 font-serif italic text-sm" style={{ opacity: 0.7 }}>
                  Seriously. Pull up a chair.
                </p>
              </div>
            </aside>
          </div>
        </section>

        {/* Bottom strip */}
        <footer className="relative z-10 border-t border-[var(--cream)]/15 mt-4">
          <div className="mx-auto max-w-7xl px-8 py-5 flex flex-wrap items-center justify-between gap-4">
            <span className="font-display italic text-[var(--cream)] text-lg" style={{ fontWeight: 500 }}>
              Come as you are. Leave sharper.
            </span>
            <div className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--cream)]/70">
              <span>est. 2026</span>
              <span>·</span>
              <span>Walk-ins welcome</span>
              <span>·</span>
              <span>No appointment needed</span>
            </div>
          </div>
        </footer>
      </main>
    );
  }

  // ─────────────── HAIR EDIT LOOP ───────────────
  if (appState === 'hairEditLoop' && sessionId && imageUrl) {
    return (
      <HairEditLoop
        sessionId={sessionId}
        initialImageUrl={imageUrl}
        profile={profile ?? mockUserHeadProfile}
        onRenderIn3D={(dataUrl) => {
          setBaldifiedDataUrl(dataUrl);
          setFaceliftPlyReady(true);
          setAppState('3d');
        }}
        onHairstepPlyReady={(plyUrl) => {
          setHairstepPlyUrl(`/api/proxy-ply?url=${encodeURIComponent(plyUrl)}`);
        }}
      />
    );
  }

  // ─────────────────────── 3D STUDIO ───────────────────────
  return (
    <main className="flex h-screen relative overflow-hidden bg-tomato-shop">
      {/* Corner wordmark */}
      <div className="absolute top-5 left-6 z-20 wordmark-stacked text-[var(--cream)]">
        <span>Shape</span>
        <span>Up</span>
      </div>

      {/* Chonk overlay title */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none text-center">
        <h2 className="type-chonk text-[var(--cream)]" style={{ fontSize: 'clamp(2.2rem, 5vw, 4rem)', opacity: 0.96 }}>
          THE <em style={{ color: 'var(--butter)' }}>studio</em>
        </h2>
      </div>

      <div className="flex-1 min-w-0 relative flex items-center justify-center p-6 pt-24">
        {/* Polaroid thumbnail */}
        {imageUrl && (
          <div
            className="absolute top-24 left-6 z-10 polaroid wonky-l"
            style={{ width: 100, padding: '6px 6px 22px' }}
          >
            <img src={imageUrl} alt="scan" className="block w-full h-[82px] object-cover rounded-sm" />
            <div className="absolute bottom-1 inset-x-0 text-center font-display text-[var(--char)] text-sm" style={{ fontStyle: 'italic', fontWeight: 500 }}>
              you
            </div>
          </div>
        )}

        {/* 3D stage — inset on the red */}
        <div
          className="relative w-full h-full rounded-3xl overflow-hidden"
          style={{
            background: 'linear-gradient(180deg, #241a14 0%, #17110d 100%)',
            border: '1px solid rgba(255,248,234,0.12)',
            boxShadow: '0 40px 80px -30px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,248,234,0.08)',
          }}
        >
          {/* Recommendations bar — absolute overlay on the left of the 3D stage */}
          <div
            className="absolute left-3 z-10 flex flex-col overflow-y-auto"
            style={{
              top: '50%',
              transform: 'translateY(-50%)',
              maxHeight: '85%',
              paddingRight: 2,
            }}
          >
            <HairRecommendationsBar
              onHover={setPreviewPlyUrl}
              onSelect={(url) => {
                setHairstepPlyUrl(url);
                setPreviewPlyUrl(null);
              }}
            />
          </div>

          <HairScene
            params={params}
            colorRGB={profile?.currentStyle.colorRGB ?? '#3b1f0a'}
            profile={profile ?? mockUserHeadProfile}
            onPrimaryHairBBoxReady={handleHairBBoxReady}
            autoFaceliftDataUrl={baldifiedDataUrl ?? undefined}
            faceliftPlyReady={faceliftPlyReady}
            hairstepPlyUrl={previewPlyUrl ?? hairstepPlyUrl ?? undefined}
            flameData={
              smirk.result
                ? {
                    vertices: smirk.result.vertices_canonical,
                    faces: smirk.result.faces,
                  }
                : undefined
            }
          />

          {/* Mono caption strip on the stage */}
          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--cream)]/70 pointer-events-none">
            <span>live · 3d sculpt</span>
            <span>no. 03·42</span>
          </div>
        </div>
      </div>

      {/* Sidebar — cream card floating on red */}
      <aside className="w-80 flex-shrink-0 flex flex-col p-4 gap-4 relative overflow-hidden">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--cream)]">
            the toolbox
          </span>
          <button
            onClick={() => setAppState('scan')}
            className="btn-ink"
            style={{ padding: '6px 12px', fontSize: 10 }}
          >
            ✂ Start over
          </button>
        </div>

        <div
          className="flex-1 overflow-hidden rounded-2xl"
          style={{
            background: 'var(--biscuit-lt)',
            border: '1px solid rgba(42,32,26,0.1)',
            boxShadow: '0 30px 60px -24px rgba(0,0,0,0.45)',
          }}
        >
          <EditPanel
            profile={profile ?? mockUserHeadProfile}
            onParamsChange={handleParamsChange}
            sessionId={sessionId}
            latestImageUrl={imageUrl}
            onImageUpdated={(url) => setImageUrl(url)}
            onPlyReady={(plyUrl) => setHairstepPlyUrl(`/api/proxy-ply?url=${encodeURIComponent(plyUrl)}`)}
          />
        </div>
      </aside>
    </main>
  );
}

/* ─────────────── Mascot — vintage barber scissors ─────────────── */
function BarberMascot() {
  return (
    <svg viewBox="0 0 200 360" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto drop-shadow-lg scissor-mascot">
      {/* Shanks (static) */}
      <line x1="94" y1="188" x2="58" y2="266" stroke="#2a201a" strokeWidth="13" strokeLinecap="round" />
      <line x1="106" y1="188" x2="142" y2="266" stroke="#2a201a" strokeWidth="13" strokeLinecap="round" />

      {/* Finger loops (static) */}
      <circle cx="52" cy="300" r="34" fill="none" stroke="#2a201a" strokeWidth="14" />
      <circle cx="148" cy="300" r="34" fill="none" stroke="#2a201a" strokeWidth="14" />

      {/* Left blade — snips around the pivot */}
      <g className="scissor-blade-left">
        <path
          d="M 108 172 L 88 188 L 32 28 L 48 22 Z"
          fill="#2a201a"
          stroke="#2a201a"
          strokeWidth="4"
          strokeLinejoin="round"
        />
      </g>

      {/* Right blade — snips around the pivot */}
      <g className="scissor-blade-right">
        <path
          d="M 92 172 L 112 188 L 168 28 L 152 22 Z"
          fill="#2a201a"
          stroke="#2a201a"
          strokeWidth="4"
          strokeLinejoin="round"
        />
      </g>

      {/* Pivot rivet — above blades so the join is clean */}
      <circle cx="100" cy="180" r="13" fill="#2a201a" />
    </svg>
  );
}
