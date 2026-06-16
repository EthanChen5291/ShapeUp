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
import { BarberMascot, InlineWordmark, BouncyButton, ClockCounter } from '@/components/AppUI';
import { useSearchParams } from 'next/navigation';
import { useNavLoading } from '@/components/NavLoadingOverlay';
import { useSettings } from '@/contexts/SettingsContext';

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

  // Empty-prompt hint: 'hidden' | 'shown' | 'fading'. Shows for 3s then fades out.
  const [hint, setHint] = useState<'hidden' | 'shown' | 'fading'>('hidden');
  const hintTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const handleSubmit = () => {
    if (!prompt.trim()) {
      hintTimers.current.forEach(clearTimeout);
      setHint('shown');
      hintTimers.current = [
        setTimeout(() => setHint('fading'), 2700),
        setTimeout(() => setHint('hidden'), 3000),
      ];
      return;
    }
    onSubmit();
  };

  useEffect(() => () => hintTimers.current.forEach(clearTimeout), []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
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
      <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="relative flex flex-col gap-3">
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
        {hint !== 'hidden' && (
          <div
            role="status"
            className="absolute left-0 right-0 -bottom-2 translate-y-full z-20 flex items-center gap-2 rounded-xl px-3 py-2 text-sm shadow-lg pointer-events-none"
            style={{
              background: 'var(--ink)',
              color: 'var(--cream)',
              opacity: hint === 'fading' ? 0 : 1,
              transition: 'opacity 0.3s ease',
            }}
          >
            <span>✂</span>
            <span>Enter your desired hairstyle in the toolbox!</span>
          </div>
        )}
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

function SunIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.8" fill="rgba(255,248,234,0.9)" />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return (
          <line key={i}
            x1={12 + 6 * Math.cos(a)} y1={12 + 6 * Math.sin(a)}
            x2={12 + 9.5 * Math.cos(a)} y2={12 + 9.5 * Math.sin(a)}
            stroke="rgba(255,248,234,0.9)" strokeWidth="1.6" strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

// Decode a base64 data: URL to a Blob without fetch(). fetch() on a data: URL
// is a "connect" and is blocked by our CSP (connect-src has no data:), which
// silently killed the edit-image upload — see onImageUpdated.
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, comma);
  const mime = header.match(/data:([^;]+)/)?.[1] ?? 'image/png';
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export default function StudioPage() {
  const { isSignedIn } = useUser();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId as Id<'projects'>;
  const { renderQuality } = useSettings();

  const saveProject = useMutation(api.projects.save);
  const project = useQuery(api.projects.get, { projectId });
  const userQuery = useQuery(api.users.getMe);
  const isAllowlisted = useQuery(api.users.isAllowlisted) ?? false;
  const [paywallDisabled, setPaywallDisabled] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(d => setPaywallDisabled(d.paywallDisabled ?? false)).catch(() => {});
  }, []);

  useEffect(() => {
    if (searchParams.get('payment') === 'success') {
      setPaymentSuccess(true);
      router.replace(`/studio/${projectId}`);
    }
  }, [searchParams, projectId, router]);

  const [initialized, setInitialized] = useState(false);
  const [profile, setProfile] = useState<UserHeadProfile | null>(null);
  const [hairParams, setHairParams] = useState<HairParams>(mockUserHeadProfile.currentStyle.params);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [displayImageUrl, setDisplayImageUrl] = useState<string | null>(null);
  const [polaroidImgError, setPolaroidImgError] = useState(false);
  const [editSaveError, setEditSaveError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [persistedSplatUrl, setPersistedSplatUrl] = useState<string | null>(null);
  const [hairstepPlyUrl, setHairstepPlyUrl] = useState<string | null>(null);
  const [editSplatSrc, setEditSplatSrc] = useState<string | null>(null);
  const [previewPlyUrl, setPreviewPlyUrl] = useState<string | null>(null);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [editLoopPrompt, setEditLoopPrompt] = useState('');
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [sceneBackground, setSceneBackground] = useState(() => {
    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    return isDark
      ? 'url(/preview_bg_dark.jpg) center / 100% 100% no-repeat'
      : 'url(/preview_bg.jpg) center / 100% 100% no-repeat';
  });
  // CSS-mode brightness for non-default backgrounds: 0.5 → brightness(1.0) filter, bypasses Three.js color-space overlay.
  // undefined = Three.js mode (keeps the pleasant lightening on preview_bg.jpg).
  const [sceneBgBrightness, setSceneBgBrightness] = useState<number | undefined>(() => {
    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    return isDark ? 0.5 : undefined;
  });
  const [sunOpen, setSunOpen] = useState(false);
  const [hoveredDot, setHoveredDot] = useState<number | null>(null);
  const [pressingDot, setPressingDot] = useState<number | null>(null);
  const [sunHovered, setSunHovered] = useState(false);
  const [menuHidden, setMenuHidden] = useState(false);
  const [splatReady, setSplatReady] = useState(false);
  const [thumbnailCaptureKey, setThumbnailCaptureKey] = useState(0);
  const [polaroidKey, setPolaroidKey] = useState(0);


  const sceneControlsEnabled = process.env.NEXT_PUBLIC_SCENE_CONTROLS !== '0';
  const { stopLoading } = useNavLoading();

  // Clear global nav loading overlay once project data arrives from Convex
  useEffect(() => {
    if (project !== undefined) stopLoading();
  }, [project, stopLoading]);

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
    const imageS3Key = (project as { lastImageS3Key?: string }).lastImageS3Key;
    if (imageS3Key) {
      // Prefer a freshly-generated URL from the permanent S3 key over the stored
      // presigned URL, which may have expired (presigned URLs last 7 days).
      setImageUrl(`/api/img?key=${encodeURIComponent(imageS3Key)}`);
    } else if (project.lastImageUrl) {
      setImageUrl(project.lastImageUrl);
    }
    const editImageS3Key = (project as { lastEditImageS3Key?: string }).lastEditImageS3Key;
    if (editImageS3Key) {
      setDisplayImageUrl(`/api/img?key=${encodeURIComponent(editImageS3Key)}`);
    }
    const splatS3Key = (project as { splatS3Key?: string }).splatS3Key;
    if (splatS3Key) {
      setPersistedSplatUrl(`/api/proxy-ply?key=${encodeURIComponent(splatS3Key)}`);
    } else {
      const savedSplat = (project as { lastSplatUrl?: string }).lastSplatUrl;
      if (savedSplat) setPersistedSplatUrl(savedSplat);
    }
  }, [project, initialized]);

  const { splatSrc, splatKey, status: demoStatus } = useDemoFacelift(persistedSplatUrl ? null : imageUrl);
  const effectiveSplatUrl = persistedSplatUrl ?? splatSrc;

  // Promote splatSrc to persisted once done
  useEffect(() => {
    if (!splatSrc || !projectId) return;
    if (splatKey) {
      setPersistedSplatUrl(`/api/proxy-ply?key=${encodeURIComponent(splatKey)}`);
      saveProject({ projectId, splatS3Key: splatKey }).catch(() => {});
    } else {
      setPersistedSplatUrl(splatSrc);
      saveProject({ projectId, lastSplatUrl: splatSrc }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splatSrc, splatKey, projectId]);

  // Track when splat becomes ready so we can switch to studio view
  useEffect(() => {
    if (effectiveSplatUrl) setSplatReady(true);
  }, [effectiveSplatUrl]);

  // Generate thumbnail from front-facing splat render when splat first loads
  const splatThumbnailTriggered = useRef(false);
  useEffect(() => {
    if (!effectiveSplatUrl || splatThumbnailTriggered.current) return;
    splatThumbnailTriggered.current = true;
    // Wait for the .splat file to download and render before capturing
    const t = setTimeout(() => setThumbnailCaptureKey(k => k + 1), 10000);
    return () => clearTimeout(t);
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
    if (!projectId || !dataUrl || !dataUrl.startsWith('data:image/')) return;
    try {
      const [header, b64] = dataUrl.split(',');
      const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
      const bytes = atob(b64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const blob = new Blob([arr], { type: mime });
      console.log('[thumbnail] captured blob size:', blob.size);
      if (blob.size < 2048) { console.warn('[thumbnail] blob too small, skipping'); return; }
      const res = await fetch('/api/upload-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      });
      if (!res.ok) { console.error('[thumbnail] upload failed:', res.status, await res.text()); return; }
      const { key } = await res.json() as { key?: string };
      if (!key || typeof key !== 'string') { console.error('[thumbnail] no key in upload response'); return; }
      console.log('[thumbnail] saving key to project:', key);
      await saveProject({ projectId, thumbnailS3Key: key });
      console.log('[thumbnail] saved OK');
    } catch (err) { console.error('[thumbnail] non-fatal error:', err); }
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
      <main className="flex fixed inset-0 overflow-hidden" style={{ background: '#1e1e1e' }}>
        <div className="absolute top-5 left-6 z-20 flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard')}
            aria-label="Back to dashboard"
            className="btn-tomato"
            style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 20, outline: '2px solid #ffffff', outlineOffset: 2, color: '#ffffff', boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.1)' }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
            </svg>
          </button>
          <InlineWordmark cream small />
        </div>
        <div className="flex-1 min-w-0 relative" style={{ backgroundImage: 'url(/preview_bg.jpg)', backgroundSize: 'cover', backgroundPosition: 'center', zIndex: 1 }}>
          <div className="w-full h-full flex flex-col items-center justify-center gap-8 p-8">
            <div
              className={`polaroid ${previewExpanded ? '' : 'wonky-sm-l'}`}
              style={{
                width: previewExpanded ? 'min(60vh, 54vw)' : '340px',
                transition: 'width 0.4s cubic-bezier(0.34, 1.2, 0.64, 1)',
                cursor: previewExpanded ? 'zoom-out' : 'zoom-in',
              }}
              onClick={() => setPreviewExpanded(v => !v)}
            >
              <div className="tape tape-tl" />
              <div className="tape tape-tr" />
              <div className="relative overflow-hidden rounded-sm" style={{ background: '#1c1510', aspectRatio: '1' }}>
                {!polaroidImgError ? (
                  <Image src={imageUrl} alt="Your scan" fill className="object-cover" unoptimized onError={() => setPolaroidImgError(true)} />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center" style={{ opacity: 0.18 }}>
                    <div style={{ width: 60 }}><BarberMascot isStatic /></div>
                  </div>
                )}
              </div>
              <div className="absolute bottom-3 left-0 right-0 text-center">
                <span className="font-display text-[var(--char)] text-lg" style={{ fontStyle: 'italic', fontWeight: 500 }}>you ✂</span>
              </div>
            </div>
            <FaceliftLoader demoStatus={demoStatus} />
          </div>
        </div>
        <aside className="w-80 flex-shrink-0 flex flex-col p-4 gap-4 relative overflow-hidden self-start h-[70vh]">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--cream)]">the toolbox</span>
            <div className="flex items-center gap-2">
              <button disabled className="btn-ink opacity-40 cursor-not-allowed" style={{ padding: '6px 12px', fontSize: 10 }}>✦ Recommend</button>
              <button onClick={() => router.push('/dashboard')} className="btn-tomato" style={{ padding: '11px 22px', fontSize: 18, borderRadius: 20, outline: '2px solid #ffffff', outlineOffset: 2, color: '#ffffff', boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.1)' }}>✂ Home</button>
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
    return <main className="fixed inset-0 bg-tomato-shop" />;
  }

  // ── 3D Studio ──
  return (
    <main className="flex fixed inset-0 overflow-hidden bg-tomato-shop">
      <div className="absolute top-5 left-6 z-20 flex items-center gap-3">
        <button
          onClick={() => router.push('/dashboard')}
          aria-label="Back to dashboard"
          className="btn-ink"
          style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '2px solid #ffffff', color: '#ffffff' }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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
        {(displayImageUrl ?? imageUrl) && (() => { const displayImg = displayImageUrl ?? imageUrl; return (
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
              {!polaroidImgError ? (
                <img key={polaroidKey} src={displayImg!} alt="scan" className="block w-full h-full object-cover cut-develop" onError={() => setPolaroidImgError(true)} />
              ) : (
                <div className="w-full h-full flex items-center justify-center" style={{ opacity: 0.18 }}>
                  <div style={{ width: 40 }}><BarberMascot isStatic /></div>
                </div>
              )}
            </div>
            <div className="absolute bottom-1 inset-x-0 text-center font-display text-[var(--char)] text-sm" style={{ fontStyle: 'italic', fontWeight: 500 }}>you</div>
            {editSaveError && (
              <div
                className="absolute left-0 right-0 top-full mt-2 rounded-md px-2 py-1.5 text-[10px] leading-tight font-mono"
                style={{ background: 'rgba(217,78,58,0.14)', border: '1px solid rgba(217,78,58,0.4)', color: 'var(--cherry, #d94e3a)', minWidth: 160 }}
                onClick={(e) => e.stopPropagation()}
              >
                {editSaveError}
              </div>
            )}
          </div>
        ); })()}

        <div className="relative w-full h-full rounded-3xl overflow-hidden" style={{ background: 'linear-gradient(180deg, #241a14 0%, #17110d 100%)', border: '1px solid rgba(255,248,234,0.12)', boxShadow: '0 40px 80px -30px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,248,234,0.08)' }}>
          {/* Click-outside backdrop — closes palette when clicking anywhere in the scene */}
          {sunOpen && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 19 }} onClick={() => setSunOpen(false)} />
          )}
          {/* Sun button + bg palette dots */}
          <div className="absolute z-20" style={{ top: 14, right: 14 }}>
            {/* Orbital palette dots — polar layout π to 3π/2, start as dots at sun, bloom outward */}
            {([
              { thumb: '/circle_white.jpg',   bg: 'url(/preview_bg_white.jpg) center / 100% 100% no-repeat', brightness: 0.5 as number | undefined },
              { thumb: '/circle_default.jpg', bg: 'url(/preview_bg.jpg) center / 100% 100% no-repeat',       brightness: undefined as number | undefined },
              { thumb: '/circle_dark.jpg',    bg: 'url(/preview_bg_dark.jpg) center / 100% 100% no-repeat',  brightness: 0.5 as number | undefined },
              { thumb: '/circle_black.jpg',   bg: '#000000',                                                   brightness: 0.5 as number | undefined },
            ]).map(({ thumb, bg, brightness }, idx) => {
              const angle = Math.PI + (idx / 3) * (Math.PI / 2);
              const r = 50;
              const dx = r * Math.cos(angle);
              const dy = -r * Math.sin(angle);
              const isSelected = sceneBackground === bg;
              // Hover/press scale: hovered dot grows, siblings shrink, pressed dot dips (springs back = bounce).
              const dotScale = pressingDot === idx
                ? 0.82
                : hoveredDot === idx
                  ? 1.18
                  : hoveredDot !== null
                    ? 0.9
                    : 1;
              const isInteracting = hoveredDot !== null || pressingDot !== null;
              return (
                <button
                  key={bg}
                  onMouseEnter={() => setHoveredDot(idx)}
                  onMouseLeave={() => { setHoveredDot(d => (d === idx ? null : d)); setPressingDot(p => (p === idx ? null : p)); }}
                  onMouseDown={() => setPressingDot(idx)}
                  onMouseUp={() => setPressingDot(p => (p === idx ? null : p))}
                  onClick={() => { setSceneBackground(bg); setSceneBgBrightness(brightness); }}
                  title={bg}
                  style={{
                    position: 'absolute',
                    top: 17,
                    left: 17,
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    backgroundImage: `url(${thumb})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    border: isSelected ? '2px solid rgba(255,248,234,0.92)' : '1.5px solid rgba(255,248,234,0.32)',
                    cursor: 'pointer',
                    boxShadow: 'inset 0 0 9px 3px rgba(0,0,0,0.38), inset 0 0 3px 1px rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.45)',
                    padding: 0,
                    opacity: sunOpen ? 1 : 0,
                    // Start as a tiny dot on the sun (scale 0.14) and lerp larger as it rotates out — no fade-in.
                    transform: sunOpen
                      ? `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${dotScale})`
                      : `translate(-50%, -50%) translate(0px, 0px) scale(0.14)`,
                    transition: sunOpen
                      ? (isInteracting
                          // Hover/press: fast spring on scale only (overshoot gives the press bounce). No opacity → no fade.
                          ? `transform 0.26s cubic-bezier(0.34, 1.7, 0.5, 1), border 0.18s ease`
                          // Bloom open: grow + rotate out from the sun, staggered. No opacity transition → no fade-in.
                          : `transform 0.5s cubic-bezier(0.34, 1.4, 0.5, 1) ${idx * 0.07}s, border 0.18s ease`)
                      : `transform 0.3s ease-in ${(3 - idx) * 0.06}s, opacity 0.18s ease ${(3 - idx) * 0.06}s, border 0.18s ease`,
                    pointerEvents: sunOpen ? 'auto' : 'none',
                  }}
                />
              );
            })}
            {/* Sun toggle button */}
            <button
              onClick={() => setSunOpen(v => !v)}
              onMouseEnter={() => setSunHovered(true)}
              onMouseLeave={() => setSunHovered(false)}
              title="Change background"
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: sunOpen ? 'rgba(255,248,234,0.18)' : 'rgba(0,0,0,0.28)',
                border: sunOpen ? '1.5px solid rgba(255,248,234,0.7)' : '1.5px solid rgba(255,248,234,0.3)',
                backdropFilter: 'blur(6px)',
                cursor: 'pointer',
                // Smooth-lerp to 110% bigger once pressed open (stays enlarged), a touch bigger on hover.
                transform: `scale(${sunOpen ? 2.1 : sunHovered ? 1.12 : 1})`,
                transition: 'border 0.2s ease, background 0.2s ease, transform 0.32s cubic-bezier(0.34, 1.4, 0.5, 1)',
                padding: 0,
              }}
            >
              <SunIcon size={20} />
            </button>
          </div>

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
            disableKeyboardControls={!sceneControlsEnabled}
            background={sceneBackground}
            backgroundBrightness={sceneBgBrightness}
            uiHidden={menuHidden}
            captureKey={thumbnailCaptureKey}
            renderQuality={renderQuality}
            onThumbnailReady={
              (!project?.thumbnailS3Key || !project.thumbnailS3Key.startsWith('thumbnails/') || thumbnailCaptureKey > 0)
                ? handleThumbnailReady
                : undefined
            }
          />

          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between z-10">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--cream)]/70 pointer-events-none">live · 3d sculpt</span>
            <div className="flex items-center gap-2">
              {sceneControlsEnabled && (
                <button
                  onClick={() => setSceneBackground('url(/project_bg.jpg) center / 100% 100% no-repeat')}
                  title="Photo background"
                  style={{ width: 13, height: 13, borderRadius: '50%', cursor: 'pointer', backgroundImage: 'url(/project_bg.jpg)', backgroundSize: '100% 100%', border: (sceneBackground.startsWith('url(/project_bg') || sceneBackground.startsWith('url(/preview_bg_dark.jpg')) ? '2px solid rgba(255,248,234,0.9)' : '1px solid rgba(255,248,234,0.25)', flexShrink: 0 }}
                />
              )}
              {sceneControlsEnabled && ['#000000', '#1c1510', '#00b140', '#f5f0e8'].map(c => (
                <button key={c} onClick={() => setSceneBackground(c)} style={{ width: 13, height: 13, borderRadius: '50%', cursor: 'pointer', background: c, border: sceneBackground === c ? '2px solid rgba(255,248,234,0.9)' : '1px solid rgba(255,248,234,0.25)', flexShrink: 0 }} />
              ))}
              {sceneControlsEnabled && (
                <input type="color" value={sceneBackground.startsWith('#') ? sceneBackground : '#000000'} onChange={e => setSceneBackground(e.target.value)} title="Custom background" style={{ width: 16, height: 16, padding: 0, border: 'none', cursor: 'pointer', borderRadius: 3, background: 'none', flexShrink: 0 }} />
              )}
              {sceneControlsEnabled && (
                <button onClick={() => setMenuHidden(v => !v)} className="font-mono text-[9px] uppercase tracking-[0.18em] hover:text-[var(--cream)]" style={{ color: 'rgba(255,248,234,0.55)', background: 'rgba(0,0,0,0.35)', borderRadius: 4, padding: '3px 8px' }}>
                  {menuHidden ? 'show ui' : 'hide ui'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {!menuHidden && (
        <aside className="w-80 flex-shrink-0 flex flex-col px-4 pb-4 gap-3 relative overflow-y-auto cozy-scroll sidebar-in self-start max-h-[calc(100vh-0.75rem)]" style={{ paddingTop: 'calc(6rem - 4vh)', zIndex: 50 }}>
          <div className="flex items-center gap-3 flex-shrink-0" style={{ transform: 'translateY(-12px)' }}>
            <span
              className="flex items-center gap-1.5 px-3 py-1 rounded-full font-mono text-sm"
              style={{
                background: (userQuery?.credits ?? 0) > 0 ? 'rgba(255,248,234,0.12)' : 'rgba(217,78,58,0.25)',
                border: (userQuery?.credits ?? 0) > 0 ? '1px solid rgba(255,248,234,0.2)' : '1px solid rgba(217,78,58,0.5)',
                color: (userQuery?.credits ?? 0) > 0 ? 'var(--cream)' : 'var(--butter)',
                transition: 'background 0.3s, border-color 0.3s',
              }}
            >
              <img src="/shapeup_token.png" alt="token" draggable={false} style={{ width: '1.15em', height: '1.15em', borderRadius: '50%', display: 'inline-block', verticalAlign: '-0.2em', boxShadow: '0 0 0 1px rgba(42,32,26,0.22)' }} /> <ClockCounter value={userQuery?.credits ?? 0} />
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--cream)]">the toolbox</span>
            {paymentSuccess && (
              <span className="font-mono text-[10px] text-[var(--butter)] animate-pulse">✦ tokens added!</span>
            )}
          </div>
          <EditPanel
              profile={profile ?? mockUserHeadProfile}
              onParamsChange={handleParamsChange}
              sessionId={sessionId}
              latestImageUrl={imageUrl}
              onImageUpdated={(url) => {
                setDisplayImageUrl(url);
                setPreviewExpanded(false);
                setPolaroidImgError(false);
                setPolaroidKey(k => k + 1);
                setEditSaveError(null);
                // Upload the Gemini-edited image to S3 and persist under lastEditImageS3Key,
                // keeping lastImageS3Key (original scan) intact for drift prevention.
                // Every step is checked and surfaced — a silent failure here loses the
                // edit on refresh, which is exactly the bug that hid behind a swallowed catch.
                if (url.startsWith('data:') && projectId) {
                  (async () => {
                    try {
                      const blob = dataUrlToBlob(url);
                      const uploadRes = await fetch('/api/upload-edit-image', {
                        method: 'POST',
                        headers: { 'Content-Type': blob.type || 'image/png' },
                        body: blob,
                      });
                      if (!uploadRes.ok) {
                        const body = await uploadRes.text().catch(() => '');
                        console.error('[studio] edit-image upload failed:', uploadRes.status, body.slice(0, 300));
                        setEditSaveError(`Edit not saved — upload failed (HTTP ${uploadRes.status}). Refresh will lose it.`);
                        return;
                      }
                      const { key } = (await uploadRes.json()) as { key?: string };
                      if (!key) {
                        console.error('[studio] edit-image upload returned no key');
                        setEditSaveError('Edit not saved — upload returned no key. Refresh will lose it.');
                        return;
                      }
                      try {
                        await saveProject({ projectId, lastEditImageS3Key: key });
                      } catch (e) {
                        console.error('[studio] saveProject(lastEditImageS3Key) failed:', e);
                        setEditSaveError('Edit uploaded but not linked to project — refresh will lose it.');
                        return;
                      }
                      setEditSaveError(null);
                      setDisplayImageUrl(`/api/img?key=${encodeURIComponent(key)}`);
                    } catch (e) {
                      console.error('[studio] edit-image persist pipeline threw:', e);
                      setEditSaveError('Edit not saved — see console for details. Refresh will lose it.');
                    }
                  })();
                }
              }}
              userCredits={userQuery?.credits}
              paywallDisabled={paywallDisabled}
              isAllowlisted={isAllowlisted}
              projectId={projectId}
              onPlyReady={(url, splatKey) => {
                if (url.startsWith('/')) {
                  setEditSplatSrc(url);
                  if (splatKey) {
                    setPersistedSplatUrl(`/api/proxy-ply?key=${encodeURIComponent(splatKey)}`);
                    saveProject({ projectId, splatS3Key: splatKey }).catch(() => {});
                  } else {
                    const PROXY_PREFIX = '/api/proxy-ply?url=';
                    const rawUrl = url.startsWith(PROXY_PREFIX)
                      ? decodeURIComponent(url.slice(PROXY_PREFIX.length))
                      : url;
                    setPersistedSplatUrl(rawUrl);
                    saveProject({ projectId, lastSplatUrl: rawUrl }).catch(() => {});
                  }
                } else {
                  setHairstepPlyUrl(`/api/proxy-ply?url=${encodeURIComponent(url)}`);
                }
                setThumbnailCaptureKey(k => k + 1);
              }}
              onUncertain={() => setShowRecommendations(true)}
            />
        </aside>
      )}
    </main>
  );
}
