'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { Id } from '@convex/_generated/dataModel';
import { useRouter, useParams } from 'next/navigation';
import { HairMeasurementBBox, HairParams, UserHeadProfile } from '@/types';
import { buildHairMeasurementSnapshot } from '@/lib/hairMeasurementSnapshot';
import { buildCurrentProfilePayload } from '@/lib/llmPayload';
import { mockUserHeadProfile } from '@/data/mockProfile';
import { useDemoFacelift } from '@/hooks/useDemoFacelift';
import EditPanel from '@/components/EditPanel';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { BarberMascot, InlineWordmark, BouncyButton } from '@/components/AppUI';

const HairScene = dynamic(() => import('@/components/HairScene'), { ssr: false });
const HairRecommendationsBar = dynamic(() => import('@/components/HairRecommendationsBar'), { ssr: false });

type RawHairBBox = Omit<HairMeasurementBBox, 'width' | 'height' | 'depth'>;

function FaceliftLoader({ demoStatus }: { demoStatus: string }) {
  const frozen = demoStatus === 'error';
  const r = 20;
  const circumference = 2 * Math.PI * r;
  const dashoffset = circumference * 0.75;
  return (
    <div className="flex flex-col items-center gap-3 p-8">
      <div style={{ width: 48, height: 48, animation: frozen ? 'none' : 'spin 1.1s linear infinite', transformOrigin: 'center' }}>
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r={r} stroke="rgba(255,248,234,0.12)" strokeWidth="3" />
          <circle cx="24" cy="24" r={r} stroke={frozen ? 'rgba(255,248,234,0.25)' : 'var(--butter)'} strokeWidth="3" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={dashoffset} transform="rotate(-90, 24, 24)" />
        </svg>
      </div>
      {frozen ? (
        <span className="font-mono text-[10px] text-[var(--butter)] opacity-85">Error — check console</span>
      ) : (
        <span className="font-serif italic text-xs text-[var(--cream)]" style={{ opacity: 0.5 }}>Building your 3D model…</span>
      )}
    </div>
  );
}

interface DemoToolboxProps {
  profile: UserHeadProfile;
  prompt: string;
  onPromptChange: (v: string) => void;
  onSubmit: () => void;
}

function DemoToolbox({ profile, prompt, onPromptChange, onSubmit }: DemoToolboxProps) {
  const currentParams = profile.currentStyle.params;
  const llmPayload = buildCurrentProfilePayload(profile);
  const liveMeasurementsJson = JSON.stringify(llmPayload.measurementSnapshot, null, 2);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); }
  };

  return (
    <div className="flex flex-col gap-6 px-5 py-6 h-full overflow-y-auto cozy-scroll text-[var(--ink)]" style={{ background: 'var(--biscuit-lt)' }}>
      <div className="flex items-center gap-3">
        <span className="inline-block w-2 h-7 barber-pole" />
        <div>
          <div className="font-sans text-[10px] uppercase tracking-wider text-[var(--smoke)]">The barber&rsquo;s</div>
          <h2 className="font-display italic text-2xl text-[var(--ink)] leading-none" style={{ fontWeight: 500 }}>Toolbox</h2>
        </div>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="pill pill-tomato">new request</span>
          <span className="font-mono text-[10px] text-[var(--smoke)]">✂</span>
        </div>
        <textarea
          className="input-soft w-full rounded-xl px-3 py-2 text-sm resize-none h-20 placeholder:text-[var(--smoke)]"
          style={{ fontStyle: 'italic' }}
          placeholder='"Messy taper fade, please."'
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="flex gap-2">
          <button type="submit" className="btn btn-tomato flex-1" style={{ padding: '10px 16px', fontSize: 13 }}>✂ Render in 3D</button>
          <button type="button" disabled className="btn btn-denim opacity-40 cursor-not-allowed" style={{ padding: '10px 14px', fontSize: 13 }}>🎙 Voice</button>
        </div>
      </form>
      <div className="flex flex-col gap-4">
        <p className="font-mono text-[10px] text-[var(--smoke)] uppercase tracking-[0.18em]">Hair Parameters</p>
        {(['pc1', 'pc2', 'pc3', 'pc4', 'pc5', 'pc6'] as const).map((key, i) => {
          const labels = ['Hair length', 'Width', 'Ponytail-ness', 'Density', 'Wavyness', 'Parting'];
          return (
            <div key={key} className="flex flex-col gap-1">
              <div className="flex justify-between text-sm">
                <span>{labels[i]}</span>
                <span className="font-mono text-[12px] text-[var(--smoke)]">{(currentParams[key] ?? 0).toFixed(2)}</span>
              </div>
              <input type="range" min={-3} max={3} step={0.1} value={currentParams[key] ?? 0} disabled onChange={() => {}} className="slider-warm w-full opacity-40 cursor-not-allowed" />
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-2 pt-4 border-t border-dashed border-[var(--char)]/20">
        <div className="flex items-baseline justify-between">
          <span className="pill pill-denim">live measurements</span>
          <span className="font-mono text-[10px] text-[var(--smoke)]">auto</span>
        </div>
        <textarea readOnly value={liveMeasurementsJson} className="input-soft w-full rounded-xl p-3 font-mono text-[11px] leading-snug resize-none h-40 focus:outline-none" style={{ fontStyle: 'normal' }} />
      </div>
      <div className="flex flex-col gap-3 pt-4 border-t border-dashed border-[var(--char)]/20">
        <span className="pill pill-tomato">take it to your barber</span>
        <button disabled className="btn btn-cream opacity-40 cursor-not-allowed" style={{ padding: '10px 16px', fontSize: 13 }}>📜 Barber&rsquo;s order</button>
      </div>
      <div className="mt-auto pt-4 border-t border-dashed border-[var(--char)]/20 font-mono text-[10px] text-[var(--smoke)] flex items-center justify-between">
        <span>preset · <span className="text-[var(--ink)]">{profile.currentStyle.preset}</span></span>
        <span>type · <span className="text-[var(--ink)]">{profile.currentStyle.hairType}</span></span>
      </div>
    </div>
  );
}

export default function StudioPage() {
  const { isSignedIn } = useUser();
  const router = useRouter();
  const params = useParams();
  const projectId = params.projectId as Id<'projects'>;

  const saveProject = useMutation(api.projects.save);
  const project = useQuery(api.projects.get, { projectId });

  const [initialized, setInitialized] = useState(false);
  const [profile, setProfile] = useState<UserHeadProfile | null>(null);
  const [hairParams, setHairParams] = useState<HairParams>(mockUserHeadProfile.currentStyle.params);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [persistedSplatUrl, setPersistedSplatUrl] = useState<string | null>(null);
  const [hairstepPlyUrl, setHairstepPlyUrl] = useState<string | null>(null);
  const [editSplatSrc, setEditSplatSrc] = useState<string | null>(null);
  const [previewPlyUrl, setPreviewPlyUrl] = useState<string | null>(null);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [editLoopPrompt, setEditLoopPrompt] = useState('');
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [sceneBackground, setSceneBackground] = useState('#001f5b');
  const [menuHidden, setMenuHidden] = useState(false);
  const [splatReady, setSplatReady] = useState(false);
  const [thumbnailCaptureKey, setThumbnailCaptureKey] = useState(0);

  // Redirect if signed out
  useEffect(() => {
    if (isSignedIn === false) router.push('/');
  }, [isSignedIn, router]);

  // Read transient sessionId from sessionStorage (set by dashboard after scan)
  useEffect(() => {
    const sid = sessionStorage.getItem('studio_sessionId');
    if (sid) { setSessionId(sid); sessionStorage.removeItem('studio_sessionId'); }
    const splatFromSession = sessionStorage.getItem('studio_splatUrl');
    if (splatFromSession) { setPersistedSplatUrl(splatFromSession); sessionStorage.removeItem('studio_splatUrl'); }
  }, []);

  // Initialize from Convex project once loaded
  useEffect(() => {
    if (!project || initialized) return;
    setInitialized(true);
    if (project.lastProfile) setProfile(project.lastProfile as UserHeadProfile);
    if (project.lastHairParams) setHairParams(project.lastHairParams as HairParams);
    if (project.lastImageUrl) setImageUrl(project.lastImageUrl);
    const savedSplat = (project as { lastSplatUrl?: string }).lastSplatUrl;
    if (savedSplat) setPersistedSplatUrl(savedSplat);
  }, [project, initialized]);

  const { splatSrc, status: demoStatus } = useDemoFacelift(persistedSplatUrl ? null : imageUrl);
  const effectiveSplatUrl = persistedSplatUrl ?? splatSrc;

  // Promote splatSrc to persisted once done
  useEffect(() => {
    if (!splatSrc || !projectId) return;
    setPersistedSplatUrl(splatSrc);
    saveProject({ projectId, lastSplatUrl: splatSrc }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splatSrc, projectId]);

  // Track when splat becomes ready so we can switch to studio view
  useEffect(() => {
    if (effectiveSplatUrl) setSplatReady(true);
  }, [effectiveSplatUrl]);

  // Auto-save every 30s
  useEffect(() => {
    if (!projectId || !imageUrl) return;
    const t = setInterval(async () => {
      try {
        const profileToSave = profile ? {
          ...profile,
          faceScanData: profile.faceScanData ? { ...profile.faceScanData, imageDataUrl: undefined } : profile.faceScanData,
        } : undefined;
        await saveProject({
          projectId,
          lastHairParams: hairParams,
          lastProfile: profileToSave,
          lastImageUrl: imageUrl,
        });
      } catch { /* silent */ }
    }, 30_000);
    return () => clearInterval(t);
  }, [projectId, hairParams, profile, imageUrl, saveProject]);

  const handleParamsChange = useCallback((next: HairParams) => {
    setHairParams(next);
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

  const handleThumbnailReady = useCallback(async (dataUrl: string) => {
    if (!projectId) return;
    try {
      const blob = await fetch(dataUrl).then(r => r.blob());
      const { url } = await fetch('/api/upload-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      }).then(r => r.json());
      await saveProject({ projectId, thumbnailUrl: url });
    } catch { /* non-fatal */ }
  }, [projectId, saveProject]);

  // Show project-not-found state
  if (project === null) {
    return (
      <main className="fixed inset-0 flex items-center justify-center bg-tomato-shop">
        <div className="text-center text-[var(--cream)]">
          <p className="font-mono text-sm opacity-60">Project not found</p>
          <button onClick={() => router.push('/dashboard')} className="mt-4 btn btn-cream" style={{ padding: '10px 24px', fontSize: 13 }}>
            ← Dashboard
          </button>
        </div>
      </main>
    );
  }

  const faceliftReady = splatReady && !!effectiveSplatUrl;

  // Hair edit loop view (waiting for splat, or splat is ready — we stay here until user submits a prompt)
  if (!faceliftReady || (faceliftReady && editLoopPrompt === '' && !splatReady)) {
    // Show loading/preview while building
  }

  // ── Hair edit loop (splat building) ──
  if (!faceliftReady && imageUrl) {
    return (
      <main className="flex fixed inset-0 overflow-hidden bg-tomato-shop">
        <div className="absolute top-5 left-6 z-20 flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard')}
            aria-label="Back to dashboard"
            className="btn-tomato"
            style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
            </svg>
          </button>
          <InlineWordmark cream small />
        </div>
        <div className="flex-1 min-w-0 relative">
          <div className="w-full h-full flex flex-col items-center justify-center gap-8 p-8">
            <div
              className={`polaroid ${previewExpanded ? '' : 'wonky-sm-l'}`}
              style={{
                width: '100%',
                maxWidth: previewExpanded ? 'min(60vh, 54vw)' : '340px',
                transition: 'max-width 0.4s cubic-bezier(0.34, 1.2, 0.64, 1)',
                cursor: previewExpanded ? 'zoom-out' : 'zoom-in',
              }}
              onClick={() => setPreviewExpanded(v => !v)}
            >
              <div className="tape tape-tl" />
              <div className="tape tape-tr" />
              <div className="relative overflow-hidden rounded-sm" style={{ background: '#1c1510', aspectRatio: '1' }}>
                <Image src={imageUrl} alt="Your scan" fill className="object-cover" unoptimized />
              </div>
              <div className="absolute bottom-3 left-0 right-0 text-center">
                <span className="font-display text-[var(--char)] text-lg" style={{ fontStyle: 'italic', fontWeight: 500 }}>you ✂</span>
              </div>
            </div>
            <FaceliftLoader demoStatus={demoStatus} />
          </div>
        </div>
        <aside className="w-80 flex-shrink-0 flex flex-col p-4 gap-4 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--cream)]">the toolbox</span>
            <div className="flex items-center gap-2">
              <button disabled className="btn-ink opacity-40 cursor-not-allowed" style={{ padding: '6px 12px', fontSize: 10 }}>✦ Recommend</button>
              <button onClick={() => router.push('/dashboard')} className="btn-ink" style={{ padding: '6px 12px', fontSize: 10 }}>✂ Home</button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden rounded-2xl" style={{ background: 'var(--biscuit-lt)', border: '1px solid rgba(42,32,26,0.1)', boxShadow: '0 30px 60px -24px rgba(0,0,0,0.45)' }}>
            <DemoToolbox
              profile={profile ?? mockUserHeadProfile}
              prompt={editLoopPrompt}
              onPromptChange={setEditLoopPrompt}
              onSubmit={() => { if (editLoopPrompt.trim()) setSplatReady(true); }}
            />
          </div>
        </aside>
      </main>
    );
  }

  // ── Loading placeholder while project data loads ──
  if (!imageUrl && project === undefined) {
    return (
      <main className="fixed inset-0 flex items-center justify-center bg-tomato-shop">
        <div style={{ width: 48, opacity: 0.5, transform: 'rotate(186deg)' }}>
          <BarberMascot isStatic color="rgba(245,241,234,0.6)" />
        </div>
      </main>
    );
  }

  // ── 3D Studio ──
  return (
    <main className="flex fixed inset-0 overflow-hidden bg-tomato-shop">
      <div className="absolute top-5 left-6 z-20 flex items-center gap-3">
        <button
          onClick={() => router.push('/dashboard')}
          aria-label="Back to dashboard"
          className="btn-ink"
          style={{ padding: '7px 9px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
          </svg>
        </button>
        <InlineWordmark cream small />
      </div>

      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none text-center">
        <h2 className="type-chonk text-[var(--cream)]" style={{ fontSize: 'clamp(2.2rem, 5vw, 4rem)', opacity: 0.96 }}>
          THE <em style={{ color: 'var(--butter)' }}>studio</em>
        </h2>
      </div>

      <div className="flex-1 min-w-0 relative flex items-center justify-center p-6 pt-24">
        {imageUrl && (
          <div
            className={`absolute top-24 left-6 z-10 polaroid ${previewExpanded ? '' : 'wonky-l'}`}
            style={{
              width: previewExpanded ? 'min(55vh, 46vw)' : 100,
              padding: '6px 6px 22px',
              transition: 'width 0.4s cubic-bezier(0.34, 1.2, 0.64, 1)',
              cursor: previewExpanded ? 'zoom-out' : 'zoom-in',
            }}
            onClick={() => setPreviewExpanded(v => !v)}
          >
            <div style={{ aspectRatio: '1', overflow: 'hidden', borderRadius: 2, background: '#1c1510' }}>
              <img key={imageUrl} src={imageUrl} alt="scan" className="block w-full h-full object-cover cut-develop" />
            </div>
            <div className="absolute bottom-1 inset-x-0 text-center font-display text-[var(--char)] text-sm" style={{ fontStyle: 'italic', fontWeight: 500 }}>you</div>
          </div>
        )}

        <div className="relative w-full h-full rounded-3xl overflow-hidden" style={{ background: 'linear-gradient(180deg, #241a14 0%, #17110d 100%)', border: '1px solid rgba(255,248,234,0.12)', boxShadow: '0 40px 80px -30px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,248,234,0.08)' }}>
          <div className="absolute top-3 right-3 z-10">
            <HairRecommendationsBar visible={showRecommendations} onHover={setPreviewPlyUrl} onSelect={(url) => { setHairstepPlyUrl(url); setPreviewPlyUrl(null); }} />
          </div>

          <HairScene
            params={hairParams}
            colorRGB={profile?.currentStyle.colorRGB ?? '#3b1f0a'}
            profile={profile ?? mockUserHeadProfile}
            onPrimaryHairBBoxReady={handleHairBBoxReady}
            hairstepPlyUrl={previewPlyUrl ?? hairstepPlyUrl ?? undefined}
            splatSrcOverride={editSplatSrc ?? effectiveSplatUrl ?? undefined}
            disableDefaultHairLayers={!!(editSplatSrc ?? effectiveSplatUrl)}
            background={sceneBackground}
            uiHidden={menuHidden}
            captureKey={thumbnailCaptureKey}
            onThumbnailReady={handleThumbnailReady}
          />

          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between z-10">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--cream)]/70 pointer-events-none">live · 3d sculpt</span>
            <div className="flex items-center gap-2">
              {['#001f5b', '#000000', '#1c1510', '#00b140', '#f5f0e8'].map(c => (
                <button key={c} onClick={() => setSceneBackground(c)} style={{ width: 13, height: 13, borderRadius: '50%', cursor: 'pointer', background: c, border: sceneBackground === c ? '2px solid rgba(255,248,234,0.9)' : '1px solid rgba(255,248,234,0.25)', flexShrink: 0 }} />
              ))}
              <input type="color" value={sceneBackground} onChange={e => setSceneBackground(e.target.value)} title="Custom background" style={{ width: 16, height: 16, padding: 0, border: 'none', cursor: 'pointer', borderRadius: 3, background: 'none', flexShrink: 0 }} />
              <button onClick={() => setMenuHidden(v => !v)} className="font-mono text-[9px] uppercase tracking-[0.18em] hover:text-[var(--cream)]" style={{ color: 'rgba(255,248,234,0.55)', background: 'rgba(0,0,0,0.35)', borderRadius: 4, padding: '3px 8px' }}>
                {menuHidden ? 'show ui' : 'hide ui'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {!menuHidden && (
        <aside className="w-80 flex-shrink-0 flex flex-col p-4 gap-4 relative overflow-hidden sidebar-in">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--cream)]">the toolbox</span>
            <div className="flex items-center gap-2">
              <BouncyButton onClick={() => setShowRecommendations(true)} className="btn-ink" style={{ padding: '6px 12px', fontSize: 10 }}>✦ Recommend</BouncyButton>
              <BouncyButton onClick={() => router.push('/dashboard')} className="btn-ink" style={{ padding: '6px 12px', fontSize: 10 }}>✂ Home</BouncyButton>
            </div>
          </div>
          <div className="flex-1 overflow-hidden rounded-2xl" style={{ background: 'var(--biscuit-lt)', border: '1px solid rgba(42,32,26,0.1)', boxShadow: '0 30px 60px -24px rgba(0,0,0,0.45)' }}>
            <EditPanel
              profile={profile ?? mockUserHeadProfile}
              onParamsChange={handleParamsChange}
              sessionId={sessionId}
              latestImageUrl={imageUrl}
              onImageUpdated={(url) => { setImageUrl(url); setPreviewExpanded(false); }}
              onPlyReady={(url) => {
                if (url.startsWith('/')) { setEditSplatSrc(url); }
                else { setHairstepPlyUrl(`/api/proxy-ply?url=${encodeURIComponent(url)}`); }
                setThumbnailCaptureKey(k => k + 1);
              }}
              onUncertain={() => setShowRecommendations(true)}
            />
          </div>
        </aside>
      )}
    </main>
  );
}
