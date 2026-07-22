'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import dynamic from 'next/dynamic';
import { useUser } from '@clerk/nextjs';
import { useAction, useConvex, useMutation, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import BiometricConsentDialog from '@/components/BiometricConsentDialog';
import SelfieCapture from '@/components/SelfieCapture';
import { analyzeSelfie, judgeSelfie, type SelfieVerdict } from '@/lib/selfieCheck';
import { getVisitorId } from '@/lib/visitorId';
import type { BarberHairProfile } from '@/lib/barberBatchAnalysis';
import { useT, type TFunction } from '@/lib/i18n';
import type { HairParams } from '@/types';

const HairScene = dynamic(() => import('@/components/HairScene'), { ssr: false });

const BIOMETRIC_NOTICE_VERSION = 'biometric-notice-2026-06-08';
const BATCH_TILE_COUNT = 8;
const E2E_STORAGE_KEY = 'shapeup:barber-batch:e2e';
const E2E_UPDATE_EVENT = 'shapeup:barber-batch:e2e-update';

const PLACEHOLDER_HAIR_PARAMS: HairParams = {
  topLength: 1,
  sideLength: 1,
  backLength: 1,
  messiness: 0.2,
  taper: 0.5,
  pc1: 0,
  pc2: 0,
  pc3: 0,
  pc4: 0,
  pc5: 0,
  pc6: 0,
};

export type BarberBatchPhase =
  | 'rundown'
  | 'capture'
  | 'checking'
  | 'analyzing'
  | 'generating'
  | 'grid'
  | 'enlarged';

type BatchItemStatus = 'pending' | 'editing' | 'rendering' | 'done' | 'failed';

export interface BarberBatchItemSnapshot {
  _id: string;
  idx: number;
  title: string;
  prompt: string;
  why?: string;
  status: BatchItemStatus;
  imageUrl?: string;
  splatS3Key?: string;
  videoS3Key?: string;
  error?: string;
  stale?: boolean;
}

export interface BarberBatchSnapshot {
  _id: string;
  status: 'analyzing' | 'generating' | 'ready' | 'rejected' | 'failed';
  rejectionReason?: string;
  hairProfile?: BarberHairProfile;
  items: BarberBatchItemSnapshot[];
}

export interface BarberBatchFlowProps {
  barberSlug: string;
  barberName: string;
  bookingUrl?: string;
  onBook?: () => void;
  onClose: () => void;
  /** Deterministic browser coverage on the server-gated public-card fixture. */
  e2eMode?: boolean;
}

function BackIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ForwardIcon() {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6v5h-5" />
      <path d="M19 11a7.5 7.5 0 1 0 .3 5" />
    </svg>
  );
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);
  return reduced;
}

function useE2EBatchSnapshot(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<BarberBatchSnapshot | null | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    const read = () => {
      const raw = window.localStorage.getItem(E2E_STORAGE_KEY);
      if (!raw) {
        setSnapshot(null);
        return;
      }
      try {
        setSnapshot(JSON.parse(raw) as BarberBatchSnapshot);
      } catch {
        setSnapshot(null);
      }
    };
    read();
    window.addEventListener(E2E_UPDATE_EVENT, read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener(E2E_UPDATE_EVENT, read);
      window.removeEventListener('storage', read);
    };
  }, [enabled]);

  return snapshot;
}

function useSelfieUpload(e2eMode: boolean) {
  const convex = useConvex();
  const generateUploadUrl = useMutation(api.barberTryOn.generateUploadUrl);

  return useCallback(async (blob: Blob): Promise<{ storageId: string; imageUrl: string }> => {
    if (e2eMode) {
      return { storageId: 'e2e-selfie-storage', imageUrl: '/hair-previews/blowout-taper.png' };
    }
    const uploadUrl = await generateUploadUrl();
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    });
    if (!uploadResponse.ok) throw new Error('Upload failed');
    const body = await uploadResponse.json() as { storageId?: string };
    if (!body.storageId) throw new Error('Upload response was incomplete');
    const storageId = body.storageId as Id<'_storage'>;
    const imageUrl = await convex.query(api.barberTryOn.getUploadedImageUrl, { storageId });
    if (!imageUrl) throw new Error('Uploaded selfie was unavailable');
    return { storageId, imageUrl };
  }, [convex, e2eMode, generateUploadUrl]);
}

function assetUrl(key: string): string {
  return `/api/proxy-ply?key=${encodeURIComponent(key)}`;
}

function absoluteAssetUrl(key: string): string {
  const path = assetUrl(key);
  return typeof window === 'undefined' ? path : new URL(path, window.location.origin).href;
}

function profileTexture(profile: BarberHairProfile, t: TFunction) {
  const family = profile.curlClass.startsWith('1')
    ? t('Straight')
    : profile.curlClass.startsWith('2')
      ? t('Wavy')
      : profile.curlClass.startsWith('3')
        ? t('Curly')
        : t('Coily');
  return `${family} ${profile.curlClass}`;
}

function hairProfileTeaser(profile: BarberHairProfile, t: TFunction) {
  const density = profile.density === 'high'
    ? t('dense')
    : profile.density === 'med'
      ? t('medium density')
      : t('low density');
  const hairline = profile.hairline.notes?.trim() || (
    profile.hairline.state === 'intact'
      ? t('intact hairline')
      : profile.hairline.state === 'mature'
        ? t('mature hairline')
        : t('receding hairline')
  );
  return `${profileTexture(profile, t)} · ${density} · ${hairline} — ${t('these 8 work with that')}`;
}

function compactHairProfile(profile: BarberHairProfile, t: TFunction) {
  const lengths = t('{top}" top / {sides}" sides / {back}" back', {
    top: profile.lengthInches.top,
    sides: profile.lengthInches.sides,
    back: profile.lengthInches.back,
  });
  const details = [
    profileTexture(profile, t),
    t('{density} density', { density: t(profile.density) }),
    t('{state} hairline', { state: t(profile.hairline.state) }),
    profile.hairline.notes,
    lengths,
    t('{shape} face', { shape: profile.faceShape }),
    profile.growthPatterns.length
      ? t('Growth: {patterns}', { patterns: profile.growthPatterns.join(', ') })
      : undefined,
    profile.barberNotes,
  ];
  return details.filter(Boolean).join(' · ');
}

function BatchStageTracker({
  stage,
  readyCount,
}: {
  stage: 'analyzing' | 'generating';
  readyCount: number;
}) {
  const t = useT();
  const stages = [
    { key: 'analyzing', label: t('Reading your hair and face') },
    { key: 'choosing', label: t('Choosing 8 realistic styles') },
    { key: 'generating', label: t('Building every look') },
  ] as const;
  const activeIdx = stage === 'analyzing' ? 0 : 2;

  return (
    <ol className="bt-stages bbf-stages" aria-live="polite">
      {stages.map((item, index) => {
        const state = index < activeIdx ? 'done' : index === activeIdx ? 'active' : 'todo';
        return (
          <li key={item.key} className={`bt-stage is-${state}`}>
            <span className="bt-stage-dot" aria-hidden>{state === 'done' ? <CheckIcon /> : null}</span>
            <span className="bt-stage-label font-sans">
              {item.label}
              {item.key === 'generating' && state === 'active'
                ? ` — ${t('{ready} of 8 ready', { ready: readyCount })}`
                : ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function BatchTileVideo({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries[0]?.isIntersecting ?? false;
      if (visible) {
        const play = video.play();
        if (play && typeof play.catch === 'function') void play.catch(() => {});
      } else {
        video.pause();
      }
    }, { rootMargin: '120px 0px' });
    observer.observe(video);
    return () => {
      observer.disconnect();
      video.pause();
    };
  }, [src]);

  return (
    <video
      ref={ref}
      className="bbf-tile-media"
      src={src}
      aria-label={title}
      muted
      playsInline
      loop
      autoPlay
      preload="metadata"
    />
  );
}

function BarberBatchGrid({
  items,
  bouncingId,
  retryingIds,
  retryErrors,
  onOpen,
  onRetry,
}: {
  items: BarberBatchItemSnapshot[];
  bouncingId: string | null;
  retryingIds: Set<string>;
  retryErrors: Record<string, string>;
  onOpen: (item: BarberBatchItemSnapshot) => void;
  onRetry: (item: BarberBatchItemSnapshot) => void;
}) {
  const t = useT();
  const byIndex = useMemo(() => new Map(items.map((item) => [item.idx, item])), [items]);

  return (
    <ol className="bbf-grid" aria-label={t('Your 8 hairstyle matches')}>
      {Array.from({ length: BATCH_TILE_COUNT }, (_, index) => {
        const item = byIndex.get(index);
        if (!item || (item.status !== 'done' && item.status !== 'failed')) {
          return (
            <li className="bbf-tile-shell" key={item?._id ?? `pending-${index}`}>
              <div className="bbf-tile-skeleton" role="status" aria-label={t('Style {n} is still being built', { n: index + 1 })}>
                <span className="bbf-skeleton-sheen" aria-hidden />
                <span className="bbf-skeleton-state font-mono">
                  {item?.status === 'rendering'
                    ? t('Rendering')
                    : item?.status === 'editing'
                      ? t('Editing')
                      : t('Waiting')}
                </span>
              </div>
              <p className="bbf-tile-title">{item?.title || t('Style {n}', { n: index + 1 })}</p>
            </li>
          );
        }

        if (item.status === 'failed') {
          const retrying = retryingIds.has(item._id);
          return (
            <li className="bbf-tile-shell" key={item._id}>
              <div className="bbf-tile-failed">
                <p className="font-sans">{item.error || t('This look needs another pass.')}</p>
                <button
                  type="button"
                  onClick={() => onRetry(item)}
                  disabled={retrying}
                  aria-label={t('Retry {title}', { title: item.title })}
                >
                  <RetryIcon />
                  <span>{retrying ? t('Retrying…') : t('Retry')}</span>
                </button>
              </div>
              <p className="bbf-tile-title">{item.title}</p>
              {retryErrors[item._id] ? <p className="bbf-tile-error" role="alert">{retryErrors[item._id]}</p> : null}
            </li>
          );
        }

        const canOpen = Boolean(item.splatS3Key);
        return (
          <li className="bbf-tile-shell" key={item._id}>
            <button
              type="button"
              className={`bbf-tile${bouncingId === item._id ? ' is-opening' : ''}`}
              onClick={() => onOpen(item)}
              disabled={!canOpen}
              aria-label={t('Open {title} in 3D', { title: item.title })}
              data-testid={`batch-tile-${index}`}
            >
              {item.videoS3Key ? (
                <BatchTileVideo src={assetUrl(item.videoS3Key)} title={t('{title} 360 preview', { title: item.title })} />
              ) : item.imageUrl ? (
                <img
                  className="bbf-tile-media"
                  src={item.imageUrl}
                  alt={t('{title} preview', { title: item.title })}
                  loading="lazy"
                  data-testid="batch-image-fallback"
                />
              ) : (
                <span className="bbf-tile-unavailable font-sans">{t('Preview ready')}</span>
              )}
            </button>
            <p className="bbf-tile-title">{item.title}</p>
          </li>
        );
      })}
    </ol>
  );
}

function waitForSceneRelease() {
  const nextFrame = () => new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else window.setTimeout(resolve, 0);
  });
  return nextFrame().then(nextFrame);
}

export default function BarberBatchFlow({
  barberSlug,
  barberName,
  bookingUrl,
  onBook,
  onClose,
  e2eMode = false,
}: BarberBatchFlowProps) {
  const t = useT();
  const { isSignedIn, user } = useUser();
  const signedIn = Boolean(isSignedIn || e2eMode);
  const reducedMotion = useReducedMotion();
  const uploadSelfie = useSelfieUpload(e2eMode);
  const liveBatch = useQuery(
    api.barberBatch.latestForPage,
    signedIn && !e2eMode ? { slug: barberSlug } : 'skip',
  ) as BarberBatchSnapshot | null | undefined;
  const e2eBatch = useE2EBatchSnapshot(e2eMode);
  const batch = e2eBatch !== undefined ? e2eBatch : liveBatch;
  const hasStoredConsent = useQuery(
    api.users.hasBiometricConsent,
    signedIn && !e2eMode ? {} : 'skip',
  );
  const recordConsent = useMutation(api.users.recordBiometricConsent);
  const recordEvent = useMutation(api.barberPages.recordEvent);
  const sendToBarber = useAction(api.barberTryOn.sendToBarber);

  const [phase, setPhase] = useState<BarberBatchPhase>('rundown');
  const [ignoredBatchId, setIgnoredBatchId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [verdict, setVerdict] = useState<SelfieVerdict | null>(null);
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [showConsent, setShowConsent] = useState(false);
  const [bouncingId, setBouncingId] = useState<string | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({});
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<BarberBatchItemSnapshot | null>(null);
  const [sceneVisible, setSceneVisible] = useState(false);
  const [finalTouches, setFinalTouches] = useState('');
  const [finalTouchBusy, setFinalTouchBusy] = useState(false);
  const [clientPhone, setClientPhone] = useState('');
  const [sendBusy, setSendBusy] = useState(false);
  const [sendOutcome, setSendOutcome] = useState<'emailed' | 'saved' | 'failed' | null>(null);
  const initiatedHereRef = useRef(false);
  const lastWarmupRef = useRef(0);
  const autoAcceptTimerRef = useRef<number | null>(null);

  const usableBatch = batch && batch._id !== ignoredBatchId ? batch : null;
  const readyCount = usableBatch?.items.filter((item) => item.status === 'done').length ?? 0;
  const resumed = Boolean(usableBatch && !initiatedHereRef.current);

  useEffect(() => {
    if (!pendingBlob || typeof URL.createObjectURL !== 'function') {
      setPendingPreview(null);
      return;
    }
    const url = URL.createObjectURL(pendingBlob);
    setPendingPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingBlob]);

  useEffect(() => () => {
    if (autoAcceptTimerRef.current !== null) window.clearTimeout(autoAcceptTimerRef.current);
  }, []);

  useEffect(() => {
    if (!usableBatch) return;
    if (usableBatch.status === 'rejected') {
      setError(usableBatch.rejectionReason || t('That selfie needs another try.'));
      setPhase('capture');
      return;
    }
    setPhase((current) => {
      if (current === 'enlarged') return current;
      if (usableBatch.status === 'analyzing') return 'analyzing';
      if (usableBatch.status === 'generating') return 'generating';
      if (usableBatch.status === 'ready') return 'grid';
      return current;
    });
  }, [t, usableBatch]);

  useEffect(() => {
    if (!selectedItemId || !usableBatch) return;
    const current = usableBatch.items.find((item) => item._id === selectedItemId);
    if (!current) return;
    if (current.status === 'done' && current.splatS3Key) {
      setSelectedSnapshot(current);
      if (!finalTouchBusy) setSceneVisible(true);
    } else if (current.status === 'failed' && finalTouchBusy) {
      setError(current.error || t('That adjustment did not finish. Try again from the grid.'));
    }
  }, [finalTouchBusy, selectedItemId, t, usableBatch]);

  const count = useCallback((kind: 'selfieStart' | 'preview' | 'bookingClick') => {
    if (e2eMode) return;
    void recordEvent({ slug: barberSlug, kind }).catch(() => {});
  }, [barberSlug, e2eMode, recordEvent]);

  const startCapture = useCallback(() => {
    const now = Date.now();
    if (now - lastWarmupRef.current >= 30_000) {
      lastWarmupRef.current = now;
      void fetch('/api/facelift/warmup', { method: 'POST' }).catch(() => {});
    }
    count('selfieStart');
    setError('');
    setPhase('capture');
  }, [count]);

  const runBatch = useCallback(async (blob: Blob) => {
    initiatedHereRef.current = true;
    setPhase('analyzing');
    setError('');
    setVerdict(null);
    setPendingBlob(null);
    try {
      const upload = await uploadSelfie(blob);
      const fingerprint = await getVisitorId().catch(() => undefined);
      const response = await fetch('/api/barber-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barberSlug,
          selfieStorageId: upload.storageId,
          ...(fingerprint ? { fingerprint } : {}),
        }),
      });
      const data = await response.json() as {
        ok?: boolean;
        rejected?: boolean;
        reason?: string;
        error?: string;
        status?: string;
      };
      if (data.rejected) {
        setError(data.reason || t('That selfie needs another try.'));
        setPhase('capture');
        return;
      }
      if (!response.ok || !data.ok) {
        setError(data.error || t('Your looks could not be finished. Please try again.'));
        setPhase('capture');
        return;
      }
      setPhase(data.status === 'ready' ? 'grid' : 'generating');
    } catch {
      setError(t('Something went wrong. Check your connection and try again.'));
      setPhase('capture');
    }
  }, [barberSlug, t, uploadSelfie]);

  const acceptPhoto = useCallback(async (blob: Blob) => {
    if (!e2eMode && hasStoredConsent !== true) {
      setPendingBlob(blob);
      setShowConsent(true);
      return;
    }
    await runBatch(blob);
  }, [e2eMode, hasStoredConsent, runBatch]);
  const acceptPhotoRef = useRef(acceptPhoto);
  acceptPhotoRef.current = acceptPhoto;

  const handlePhoto = useCallback(async (blob: Blob) => {
    if (autoAcceptTimerRef.current !== null) window.clearTimeout(autoAcceptTimerRef.current);
    setPendingBlob(blob);
    setError('');
    setVerdict(null);
    setPhase('checking');
    let nextVerdict: SelfieVerdict;
    try {
      nextVerdict = judgeSelfie(await analyzeSelfie(blob));
    } catch {
      nextVerdict = { level: 'fail', message: 'That photo didn’t load — try another one.' };
    }
    setVerdict(nextVerdict);
    if (nextVerdict.level === 'ok') {
      autoAcceptTimerRef.current = window.setTimeout(
        () => {
          autoAcceptTimerRef.current = null;
          void acceptPhotoRef.current(blob);
        },
        reducedMotion ? 0 : 450,
      );
    }
  }, [reducedMotion]);

  const retake = useCallback(() => {
    if (autoAcceptTimerRef.current !== null) {
      window.clearTimeout(autoAcceptTimerRef.current);
      autoAcceptTimerRef.current = null;
    }
    setPendingBlob(null);
    setVerdict(null);
    setError('');
    setPhase('capture');
  }, []);

  const startOver = useCallback(() => {
    if (autoAcceptTimerRef.current !== null) {
      window.clearTimeout(autoAcceptTimerRef.current);
      autoAcceptTimerRef.current = null;
    }
    setSceneVisible(false);
    setSelectedItemId(null);
    setSelectedSnapshot(null);
    setIgnoredBatchId(usableBatch?._id ?? null);
    initiatedHereRef.current = false;
    setPendingBlob(null);
    setVerdict(null);
    setError('');
    setSendOutcome(null);
    setFinalTouches('');
    setPhase('rundown');
  }, [usableBatch?._id]);

  const openItem = useCallback((item: BarberBatchItemSnapshot) => {
    if (!item.splatS3Key) return;
    setBouncingId(item._id);
    const open = () => {
      setSelectedItemId(item._id);
      setSelectedSnapshot(item);
      setFinalTouches('');
      setSendOutcome(null);
      setError('');
      setSceneVisible(true);
      setBouncingId(null);
      setPhase('enlarged');
      count('preview');
    };
    if (reducedMotion) open();
    else window.setTimeout(open, 180);
  }, [count, reducedMotion]);

  const backToGrid = useCallback(() => {
    setSceneVisible(false);
    setSelectedItemId(null);
    setSelectedSnapshot(null);
    setFinalTouches('');
    setError('');
    setPhase(usableBatch?.status === 'generating' ? 'generating' : 'grid');
  }, [usableBatch?.status]);

  const retryItem = useCallback(async (item: BarberBatchItemSnapshot) => {
    setRetryingIds((current) => new Set(current).add(item._id));
    setRetryErrors((current) => ({ ...current, [item._id]: '' }));
    try {
      const response = await fetch('/api/barber-batch/item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item._id }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setRetryErrors((current) => ({
          ...current,
          [item._id]: data.error || t('This look could not be retried.'),
        }));
      }
    } catch {
      setRetryErrors((current) => ({
        ...current,
        [item._id]: t('Check your connection and retry this look.'),
      }));
    } finally {
      setRetryingIds((current) => {
        const next = new Set(current);
        next.delete(item._id);
        return next;
      });
    }
  }, [t]);

  const submitFinalTouches = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const prompt = finalTouches.trim();
    if (!selectedSnapshot || !prompt || finalTouchBusy) return;
    setFinalTouchBusy(true);
    setSceneVisible(false);
    setError('');
    await waitForSceneRelease();
    try {
      const response = await fetch('/api/barber-batch/item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: selectedSnapshot._id, extraPrompt: prompt }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setError(data.error || t('That adjustment did not finish. Please try again.'));
        setSceneVisible(Boolean(selectedSnapshot.splatS3Key));
      } else {
        setFinalTouches('');
      }
    } catch {
      setError(t('Something went wrong. Check your connection and try again.'));
      setSceneVisible(Boolean(selectedSnapshot.splatS3Key));
    } finally {
      setFinalTouchBusy(false);
    }
  }, [finalTouchBusy, finalTouches, selectedSnapshot, t]);

  const handleSend = useCallback(async () => {
    if (!selectedSnapshot?.imageUrl || !usableBatch?.hairProfile || sendBusy) return;
    setSendBusy(true);
    setSendOutcome(null);
    try {
      const result = await sendToBarber({
        slug: barberSlug,
        cutLabel: selectedSnapshot.title,
        imageUrl: selectedSnapshot.imageUrl,
        videoUrl: selectedSnapshot.videoS3Key
          ? absoluteAssetUrl(selectedSnapshot.videoS3Key)
          : undefined,
        clientRequest: selectedSnapshot.prompt,
        styleTitle: selectedSnapshot.title,
        stylePrompt: selectedSnapshot.prompt,
        hairProfile: compactHairProfile(usableBatch.hairProfile, t),
        clientEmail: user?.primaryEmailAddress?.emailAddress,
        clientPhone: clientPhone.trim() || undefined,
      });
      setSendOutcome(result.ok ? (result.emailed ? 'emailed' : 'saved') : 'failed');
    } catch {
      setSendOutcome('failed');
    } finally {
      setSendBusy(false);
    }
  }, [barberSlug, clientPhone, selectedSnapshot, sendBusy, sendToBarber, t, usableBatch?.hairProfile, user]);

  const selectedItem = selectedItemId && usableBatch
    ? usableBatch.items.find((item) => item._id === selectedItemId)
    : undefined;
  const selected = selectedItem?.status === 'done' ? selectedItem : selectedSnapshot;
  const gridItems = usableBatch?.items ?? [];

  return (
    <section className="bt-panel bbf-panel" aria-label={t('Your best hairstyle matches')} data-phase={phase}>
      <header className="bt-head">
        <button
          type="button"
          className="bt-back"
          onClick={phase === 'enlarged' ? backToGrid : onClose}
        >
          <BackIcon />
          <span className="font-sans">{phase === 'enlarged' ? t('All 8 looks') : t('Back')}</span>
        </button>
        <span className="bt-cut font-mono">
          {phase === 'enlarged' && selected ? selected.title : t('Best matches')}
        </span>
      </header>

      {phase === 'rundown' ? (
        <div className="bbf-rundown">
          <div className="bbf-rundown-heading">
            <p className="bc-book-eyebrow font-mono">{t('One selfie · eight ideas')}</p>
            <h2>{t('Here’s how it works.')}</h2>
          </div>
          <ol className="bbf-rundown-list">
            {[
              t('Take or upload one selfie'),
              t('We show you 8 hairstyles picked for your face and hair.'),
              t('Choose your favorite and make final touches.'),
              t("We'll send it to your barber along with the appointment."),
            ].map((copy, index) => (
              <li
                key={copy}
                className="bbf-rundown-item"
                data-stagger-delay={reducedMotion ? 0 : index * 500}
                style={{ '--bbf-delay': `${reducedMotion ? 0 : index * 500}ms` } as CSSProperties}
              >
                <span className="bbf-rundown-number font-mono">0{index + 1}</span>
                <span className="font-sans">{copy}</span>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="bc-choice-btn is-accent bbf-rundown-go"
            style={{ '--bbf-delay': `${reducedMotion ? 0 : 2000}ms` } as CSSProperties}
            onClick={startCapture}
          >
            <span>{t("Let's go.")}</span>
            <ForwardIcon />
          </button>
        </div>
      ) : null}

      {phase === 'capture' ? (
        <div className="bt-capture">
          <h2 className="bt-step-title">{t('Take a selfie')}</h2>
          <p className="bbf-step-copy font-sans">{t('Keep your hairline, both temples, and full face visible.')}</p>
          <SelfieCapture onPhoto={(blob) => void handlePhoto(blob)} />
          {error ? <p className="bt-error font-sans" role="alert">{error}</p> : null}
        </div>
      ) : null}

      {phase === 'checking' ? (
        <div className="bt-check">
          {pendingPreview ? (
            <div className="bt-check-frame"><img src={pendingPreview} alt={t('Your photo')} /></div>
          ) : null}
          {!verdict ? (
            <p className="bt-check-status font-sans" role="status">{t('Checking your photo…')}</p>
          ) : verdict.level === 'ok' ? (
            <p className="bt-check-status bt-check-ok font-sans" role="status"><CheckIcon /> {t('Photo looks good')}</p>
          ) : (
            <>
              <p className="bt-check-status font-sans" role="alert">{t(verdict.message)}</p>
              <div className="bt-check-actions">
                <button type="button" className="bt-btn" onClick={retake}>{t('Retake')}</button>
                {verdict.level === 'warn' && pendingBlob ? (
                  <button type="button" className="bt-btn is-primary" onClick={() => void acceptPhoto(pendingBlob)}>
                    {t('Use this photo')}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}

      {phase === 'analyzing' ? (
        <div className="bbf-analyzing">
          <div className="bbf-progress-heading">
            <p className="bc-book-eyebrow font-mono">{t('Personal analysis')}</p>
            <h2>{t('Finding what works with your hair.')}</h2>
          </div>
          <BatchStageTracker stage="analyzing" readyCount={readyCount} />
          {error ? <p className="bt-error font-sans" role="alert">{error}</p> : null}
        </div>
      ) : null}

      {phase === 'generating' || phase === 'grid' ? (
        <div className="bbf-results">
          <div className="bbf-results-head">
            <div>
              <p className="bc-book-eyebrow font-mono">
                {resumed ? t('Your looks from earlier') : t('Your best matches')}
              </p>
              <h2>{phase === 'generating' ? t('Your chair is filling up.') : t('Eight cuts, picked for you.')}</h2>
            </div>
            <button type="button" className="bbf-start-over font-sans" onClick={startOver}>{t('Start over')}</button>
          </div>
          {usableBatch?.hairProfile ? (
            <p className="bbf-profile-teaser font-sans">{hairProfileTeaser(usableBatch.hairProfile, t)}</p>
          ) : null}
          {phase === 'generating' ? <BatchStageTracker stage="generating" readyCount={readyCount} /> : null}
          <BarberBatchGrid
            items={gridItems}
            bouncingId={bouncingId}
            retryingIds={retryingIds}
            retryErrors={retryErrors}
            onOpen={openItem}
            onRetry={(item) => void retryItem(item)}
          />
        </div>
      ) : null}

      {phase === 'enlarged' && selected ? (
        <div className="bbf-enlarged">
          <div className="bbf-enlarged-heading">
            <p className="bc-book-eyebrow font-mono">{t('Your pick')}</p>
            <h2>{selected.title}</h2>
            {selected.why ? <p className="font-sans">{selected.why}</p> : null}
          </div>
          <div className="bt-result-frame is-3d bbf-scene-frame">
            {sceneVisible && selected.splatS3Key && !finalTouchBusy ? (
              <div className="bt-scene bt-scene-arrive" data-testid="batch-hair-scene">
                {e2eMode ? <div className="bbf-scene-e2e" /> : (
                  <HairScene
                    key={`${selected._id}:${selected.splatS3Key}`}
                    params={PLACEHOLDER_HAIR_PARAMS}
                    splatSrcOverride={assetUrl(selected.splatS3Key)}
                    disableDefaultHairLayers
                    disableKeyboardControls
                    renderQuality="balanced"
                    background="#141416"
                  />
                )}
                <span className="bt-scene-hint font-mono">{t('Drag to rotate · scroll to zoom')}</span>
              </div>
            ) : selected.imageUrl ? (
              <img src={selected.imageUrl} alt={t('{title} preview', { title: selected.title })} />
            ) : null}
            {finalTouchBusy ? (
              <div className="bt-result-busy"><BatchStageTracker stage="generating" readyCount={readyCount} /></div>
            ) : null}
          </div>

          {error ? <p className="bt-error font-sans" role="alert">{error}</p> : null}

          <form className="bbf-final-form" onSubmit={(event) => void submitFinalTouches(event)}>
            <label htmlFor="barber-final-touches" className="font-mono">{t('Make a small adjustment')}</label>
            <div className="bt-prompt">
              <input
                id="barber-final-touches"
                className="bt-prompt-input font-sans"
                value={finalTouches}
                onChange={(event) => setFinalTouches(event.target.value)}
                placeholder={t('Final Touches')}
                maxLength={200}
                disabled={finalTouchBusy || sendBusy}
              />
              <button type="submit" className="bt-prompt-go" disabled={!finalTouches.trim() || finalTouchBusy || sendBusy}>
                {finalTouchBusy ? t('Applying…') : t('Apply')}
              </button>
            </div>
          </form>

          <div className="bt-actions">
            {!sendOutcome ? (
              <button type="button" className="bt-btn is-primary" onClick={() => void handleSend()} disabled={sendBusy || finalTouchBusy || !selected.imageUrl}>
                {sendBusy ? t('Sending 360…') : t('Send 360 to {name}', { name: barberName })}
              </button>
            ) : (
              <div className="bt-sent font-sans" role="status">
                {sendOutcome === 'emailed' ? t('Sent! They’ll see exactly what you want before you sit down.') : null}
                {sendOutcome === 'saved' ? t('Sent to {name}’s ShapeUp inbox — they’ll see it before your cut.', { name: barberName }) : null}
                {sendOutcome === 'failed' ? t('Couldn’t send that — screenshot this and show them in the chair instead.') : null}
              </div>
            )}
            {onBook ? (
              <button type="button" className="bt-btn is-book" onClick={onBook}>{t('Book with {name}', { name: barberName })}</button>
            ) : bookingUrl ? (
              <a
                className="bt-btn is-book"
                href={bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => count('bookingClick')}
              >
                {t('Book with {name}', { name: barberName })}
              </a>
            ) : null}
          </div>

          {!sendOutcome ? (
            <label className="bt-phone">
              <span className="font-mono">{t('Phone (optional)')}</span>
              <input
                className="bt-phone-input font-sans"
                type="tel"
                value={clientPhone}
                onChange={(event) => setClientPhone(event.target.value)}
                placeholder="(415) 555-0134"
                disabled={sendBusy || finalTouchBusy}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {showConsent ? (
        <BiometricConsentDialog
          onCancel={() => {
            setShowConsent(false);
            retake();
          }}
          onAccept={async () => {
            try {
              await recordConsent({ noticeVersion: BIOMETRIC_NOTICE_VERSION });
              setShowConsent(false);
              const blob = pendingBlob;
              if (blob) await runBatch(blob);
            } catch {
              setShowConsent(false);
              setError(t('Could not save consent. Please try again.'));
              setPhase('capture');
            }
          }}
        />
      ) : null}
    </section>
  );
}
