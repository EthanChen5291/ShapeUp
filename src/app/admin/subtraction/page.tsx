'use client';

// /admin/subtraction — Hair Extraction Lab
// Flow:
//  1. Capture  — user takes a photo
//  2. BaldGen  — client-side canvas manipulation creates a "bald" version
//  3. Scan×2   — both images run through FaceLift in parallel → two PLY files
//  4. Subtract — /api/admin/subtraction/subtract isolates the "hair" gaussians
//  5. Done     — render the hair splat + show debug info

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useUser, useClerk } from '@clerk/nextjs';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import Link from 'next/link';

const TAG = '[subtraction]';
function dbg(msg: string, ...args: unknown[]) {
  console.log(`${TAG} ${new Date().toISOString()} ${msg}`, ...args);
}
function dbgErr(msg: string, ...args: unknown[]) {
  console.error(`${TAG} ERROR: ${msg}`, ...args);
}

// Load R3F viewer only on client to avoid SSR issues
const HairSplatViewer = dynamic(() => import('./HairSplatViewer'), { ssr: false });
const ErasableSplatViewer = dynamic(() => import('./ErasableSplatViewer'), { ssr: false });

// ─── types ────────────────────────────────────────────────────────────────────

type StepId   = 'capture' | 'bald_gen' | 'original_scan' | 'bald_scan' | 'subtracting' | 'done';
type StepStatus = 'pending' | 'running' | 'done' | 'error';

interface StepState {
  status:  StepStatus;
  label:   string;
  detail?: string;
  timing?: number; // ms
  error?:  string;
}

interface FaceliftResult {
  jobId:    string;
  plyUrl:   string;
  splatUrl: string;
}

interface SubtractOpts {
  scaleX?:            number;
  scaleY?:            number;
  scaleZ?:            number;
  uniformScale?:      number;
  voxelSizeOverride?: number;
  maskCloseThreshold?: number;
}

interface SubtractResult {
  jobId:         string;
  plyUrl:        string;
  splatUrl:      string;
  keptCount:     number;
  totalOriginal: number;
  totalBald:     number;
  retainedPct:   number;
  overlapCount:  number;
  closedCount?:  number;
  voxelSize:     number;
  processingMs:  number;
  opts?:         SubtractOpts;
}

type Phase = 'consent' | 'camera' | 'processing' | 'done' | 'error';

const STEP_ORDER: StepId[] = ['capture', 'bald_gen', 'original_scan', 'bald_scan', 'subtracting', 'done'];

function initialSteps(): Record<StepId, StepState> {
  return {
    capture:       { status: 'pending', label: '1 · Capture'              },
    bald_gen:      { status: 'pending', label: '2 · Generate bald version' },
    original_scan: { status: 'pending', label: '3 · Scan original'         },
    bald_scan:     { status: 'pending', label: '4 · Scan bald version'      },
    subtracting:   { status: 'pending', label: '5 · Subtract PLY files'     },
    done:          { status: 'pending', label: '6 · Hair in 3D'             },
  };
}

// ─── bald image generation via the image model ─────────────────────────────────────

async function generateBaldImage(
  imageDataUrl: string,
  pushLog: (s: string) => void,
): Promise<{ baldDataUrl: string }> {
  const log = (s: string) => { dbg(`[generateBaldImage] ${s}`); pushLog(s); };

  log('sending image to the image model for baldification (~15-30s)...');
  const t0  = Date.now();

  const res = await fetch('/api/baldify', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ imageDataUrl }),
  });

  log(`image model response: HTTP ${res.status} in ${Date.now() - t0}ms`);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`image model baldify failed: HTTP ${res.status} — ${text.substring(0, 300)}`);
  }

  const data = await res.json() as { baldifiedDataUrl?: string; error?: string };
  if (data.error) throw new Error(`image model baldify error: ${data.error}`);
  if (!data.baldifiedDataUrl) throw new Error('image model returned no image');

  log(`image model baldification done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${data.baldifiedDataUrl.length} chars`);
  return { baldDataUrl: data.baldifiedDataUrl };
}

// ─── facelift caller ──────────────────────────────────────────────────────────

async function callFacelift(
  imageDataUrl: string,
  tag: string,
  pushLog: (s: string) => void,
): Promise<FaceliftResult> {
  const log    = (s: string) => { dbg(`[callFacelift/${tag}] ${s}`); pushLog(`[${tag}] ${s}`); };
  const t0     = Date.now();

  log(`sending ${imageDataUrl.length} chars to /api/facelift...`);
  const res = await fetch('/api/facelift', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ imageDataUrl, outputName: `subtraction-${tag}` }),
  });

  log(`response status: ${res.status} in ${Date.now() - t0}ms`);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err  = `HTTP ${res.status}: ${text.substring(0, 300)}`;
    log(`ERROR: ${err}`);
    throw new Error(err);
  }

  const data = await res.json() as { jobId?: string; plyUrl?: string; splatUrl?: string; error?: string };
  log(`response body: jobId=${data.jobId}, plyUrl=${(data.plyUrl ?? '').substring(0, 60)}...`);

  if (data.error) throw new Error(data.error);
  if (!data.jobId || !data.plyUrl || !data.splatUrl) {
    throw new Error(`Invalid facelift response — missing fields: ${JSON.stringify(Object.keys(data))}`);
  }

  log(`success in ${Date.now() - t0}ms — jobId=${data.jobId}`);
  return { jobId: data.jobId, plyUrl: data.plyUrl, splatUrl: data.splatUrl };
}

// ─── subtract caller ──────────────────────────────────────────────────────────

async function callSubtract(
  originalPlyUrl: string,
  baldPlyUrl: string,
  pushLog: (s: string) => void,
  opts?: SubtractOpts,
): Promise<SubtractResult> {
  const log = (s: string) => { dbg(`[callSubtract] ${s}`); pushLog(`[subtract] ${s}`); };
  const t0  = Date.now();

  log(`POSTing to /api/admin/subtraction/subtract...`);
  log(`  originalPlyUrl: ${originalPlyUrl.substring(0, 80)}...`);
  log(`  baldPlyUrl: ${baldPlyUrl.substring(0, 80)}...`);
  log(`  opts: ${JSON.stringify(opts ?? {})}`);

  const res = await fetch('/api/admin/subtraction/subtract', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ originalPlyUrl, baldPlyUrl, ...opts }),
  });

  log(`response status: ${res.status} in ${Date.now() - t0}ms`);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err  = `HTTP ${res.status}: ${text.substring(0, 300)}`;
    log(`ERROR: ${err}`);
    throw new Error(err);
  }

  const data = await res.json() as SubtractResult & { error?: string };
  log(`response: jobId=${data.jobId}, keptCount=${data.keptCount}/${data.totalOriginal}, retainedPct=${data.retainedPct}%, overlap=${data.overlapCount}`);
  log(`  voxelSize=${data.voxelSize.toFixed(6)}, processingMs=${data.processingMs}`);
  if (data.opts) log(`  server confirmed opts: ${JSON.stringify(data.opts)}`);

  if (data.error) throw new Error(data.error);
  if (!data.splatUrl) throw new Error('subtract response missing splatUrl');

  log(`success in ${Date.now() - t0}ms`);
  return data;
}

// ─── overlay draw (mirrors ScanCamera) ───────────────────────────────────────

function drawOverlay(ctx: CanvasRenderingContext2D, W: number, H: number, captured: boolean) {
  const cx = W / 2, cy = H * 0.46, rx = W * 0.32, ry = H * 0.40;

  ctx.save();
  ctx.fillStyle = 'rgba(35,27,20,0.04)';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = captured ? '#ffe39a' : '#d63c2f';
  ctx.lineWidth   = 2.5;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.6;
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.ellipse(cx + 1, cy - 1, rx - 1, ry + 1, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = '#fff5dc';
  ctx.lineWidth   = 2;
  ctx.lineCap     = 'round';
  const b = 22, p = 14;
  [[p, p], [W - p, p], [p, H - p], [W - p, H - p]].forEach(([x, y], idx) => {
    const dx = idx % 2 === 0 ? 1 : -1;
    const dy = idx < 2 ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(x, y + dy * b);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * b, y);
    ctx.stroke();
  });
}

// ─── step UI ──────────────────────────────────────────────────────────────────

function StepRow({ step }: { step: StepState }) {
  const icon =
    step.status === 'pending' ? '○' :
    step.status === 'running' ? '◉' :
    step.status === 'done'    ? '✓' : '✕';

  const color =
    step.status === 'pending' ? '#665' :
    step.status === 'running' ? '#ffe39a' :
    step.status === 'done'    ? '#7ec88b' : '#d63c2f';

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ color, fontFamily: 'monospace', fontSize: 16, minWidth: 18, lineHeight: '22px' }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ color: color, fontFamily: 'monospace', fontSize: 13, fontWeight: 700 }}>{step.label}</div>
        {step.detail && (
          <div style={{ color: '#887', fontFamily: 'monospace', fontSize: 11, marginTop: 2 }}>{step.detail}</div>
        )}
        {step.timing != null && (
          <div style={{ color: '#665', fontFamily: 'monospace', fontSize: 10, marginTop: 1 }}>{(step.timing / 1000).toFixed(1)}s</div>
        )}
        {step.error && (
          <div style={{ color: '#d63c2f', fontFamily: 'monospace', fontSize: 11, marginTop: 3, whiteSpace: 'pre-wrap' }}>{step.error}</div>
        )}
      </div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function SubtractionPage() {
  const { isSignedIn } = useUser();
  const { openSignIn } = useClerk();

  const convexUser             = useQuery(api.users.getMe);
  const recordBiometricConsent = useMutation(api.users.recordBiometricConsent);

  const [phase,          setPhase]          = useState<Phase>('camera');
  const [steps,          setSteps]          = useState<Record<StepId, StepState>>(initialSteps);
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentSaving,  setConsentSaving]  = useState(false);
  const [fatalError,     setFatalError]     = useState<string | null>(null);
  const [debugLines,     setDebugLines]     = useState<string[]>([]);

  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [baldDataUrl,     setBaldDataUrl]     = useState<string | null>(null);
  const [originalResult,  setOriginalResult]  = useState<FaceliftResult | null>(null);
  const [baldResult,      setBaldResult]      = useState<FaceliftResult | null>(null);
  const [subResult,       setSubResult]       = useState<SubtractResult | null>(null);

  // Subtraction params (editable after scans complete)
  const [subScaleX,         setSubScaleX]         = useState(1.0);
  const [subScaleY,         setSubScaleY]         = useState(1.0);
  const [subScaleZ,         setSubScaleZ]         = useState(1.0);
  const [subUniformScale,   setSubUniformScale]   = useState(1.0);
  const [subVoxelOverride,  setSubVoxelOverride]  = useState('');   // empty = auto
  const [subMaskClose,      setSubMaskClose]      = useState(0.55); // streak cleanup; 1 = off
  const [rerunning,         setRerunning]         = useState(false);

  const [cameraFailed, setCameraFailed] = useState(false);

  const videoRef      = useRef<HTMLVideoElement>(null);
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const animFrameRef  = useRef<number | null>(null);
  const activeRef     = useRef(false);
  const debugEndRef   = useRef<HTMLDivElement>(null);

  const hasBiometricConsent = Boolean(convexUser?.biometricConsentAt);

  // ── push to debug log ──
  const pushLog = useCallback((msg: string) => {
    const ts = new Date().toISOString().slice(11, 23);
    setDebugLines(prev => [...prev.slice(-299), `${ts}  ${msg}`]);
  }, []);

  // ── auto-scroll debug ──
  useEffect(() => {
    debugEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [debugLines]);

  // ── step updater ──
  const updateStep = useCallback((id: StepId, update: Partial<StepState>) => {
    dbg(`updateStep: ${id} → status=${update.status ?? '?'} detail=${update.detail ?? ''}`);
    setSteps(prev => ({ ...prev, [id]: { ...prev[id], ...update } }));
  }, []);

  // ─── camera init ────────────────────────────────────────────────────────────

  const drawFrame = useCallback(() => {
    if (!activeRef.current) return;
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState >= 2) {
      const ctx   = canvas.getContext('2d')!;
      const W     = 640, H = 640;
      const vW    = video.videoWidth  || 640;
      const vH    = video.videoHeight || 480;
      const crop  = Math.min(vW, vH);
      const cropX = (vW - crop) / 2;
      const cropY = (vH - crop) / 2;
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, cropX, cropY, crop, crop, 0, 0, W, H);
      ctx.restore();
      drawOverlay(ctx, W, H, false);
    }
    animFrameRef.current = requestAnimationFrame(drawFrame);
  }, []);

  useEffect(() => {
    if (phase !== 'camera') return;
    dbg('camera effect: starting getUserMedia...');

    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 1280, height: 960 },
          audio: false,
        });
        const video = videoRef.current!;
        video.srcObject = stream;
        video.setAttribute('playsinline', '');
        await video.play();
        dbg('camera effect: stream active');
        activeRef.current = true;
        animFrameRef.current = requestAnimationFrame(drawFrame);
      } catch (err) {
        dbgErr('camera effect: getUserMedia failed:', err);
        setFatalError(`Camera unavailable: ${err instanceof Error ? err.message : String(err)}`);
        setCameraFailed(true);
        // Stay on 'camera' phase so the upload option remains accessible.
      }
    })();

    return () => {
      dbg('camera effect cleanup: stopping stream');
      activeRef.current = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [phase, drawFrame]);

  // ─── capture ─────────────────────────────────────────────────────────────────

  async function handleCapture() {
    dbg('handleCapture: starting...');

    if (!isSignedIn) { openSignIn(); return; }

    if (!hasBiometricConsent) {
      if (!consentChecked) {
        setFatalError('Please check the biometric consent box before scanning.');
        return;
      }
      dbg('handleCapture: saving biometric consent...');
      setConsentSaving(true);
      try {
        await recordBiometricConsent({ noticeVersion: 'biometric-notice-2026-06-08' });
        dbg('handleCapture: consent saved');
      } catch (err) {
        dbgErr('handleCapture: consent save failed:', err);
        setFatalError('Could not save consent. Please try again.');
        return;
      } finally {
        setConsentSaving(false);
      }
    }

    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) { dbgErr('handleCapture: refs not ready'); return; }

    activeRef.current = false;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    const W = 640, H = 640;
    const ctx   = canvas.getContext('2d')!;
    const vW    = video.videoWidth  || 640;
    const vH    = video.videoHeight || 480;
    const crop  = Math.min(vW, vH);
    const cropX = (vW - crop) / 2;
    const cropY = (vH - crop) / 2;
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, cropX, cropY, crop, crop, 0, 0, W, H);
    ctx.restore();
    const dataUrl = canvas.toDataURL('image/png');
    drawOverlay(ctx, W, H, true);

    const stream = video.srcObject as MediaStream | null;
    stream?.getTracks().forEach(t => t.stop());

    dbg(`handleCapture: captured ${dataUrl.length} chars`);
    setCapturedDataUrl(dataUrl);
    updateStep('capture', { status: 'done', detail: `${W}×${H} PNG captured` });

    // Kick off the pipeline
    runPipeline(dataUrl);
  }

  // ─── upload ──────────────────────────────────────────────────────────────────

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!e.target) return;
    e.target.value = '';   // reset so same file can be re-selected
    if (!file) return;

    if (!isSignedIn) { openSignIn(); return; }

    if (!hasBiometricConsent) {
      if (!consentChecked) {
        setFatalError('Please check the biometric consent box before scanning.');
        return;
      }
      dbg('handleUpload: saving biometric consent...');
      setConsentSaving(true);
      try {
        await recordBiometricConsent({ noticeVersion: 'biometric-notice-2026-06-08' });
        dbg('handleUpload: consent saved');
      } catch (err) {
        dbgErr('handleUpload: consent save failed:', err);
        setFatalError('Could not save consent. Please try again.');
        return;
      } finally {
        setConsentSaving(false);
      }
    }

    // Stop camera if running
    activeRef.current = false;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    const video = videoRef.current;
    if (video) {
      (video.srcObject as MediaStream | null)?.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }

    dbg(`handleUpload: reading file "${file.name}" (${file.size} bytes)`);

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const W = 640, H = 640;
        const ctx = canvas.getContext('2d')!;

        // Center-crop to square then scale to 640×640
        const crop = Math.min(img.naturalWidth, img.naturalHeight);
        const cropX = (img.naturalWidth  - crop) / 2;
        const cropY = (img.naturalHeight - crop) / 2;
        ctx.drawImage(img, cropX, cropY, crop, crop, 0, 0, W, H);

        const dataUrl = canvas.toDataURL('image/png');
        drawOverlay(ctx, W, H, true);

        dbg(`handleUpload: image drawn — ${W}×${H}, dataUrl length=${dataUrl.length}`);
        setCapturedDataUrl(dataUrl);
        updateStep('capture', { status: 'done', detail: `${file.name} (${W}×${H})` });
        runPipeline(dataUrl);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  // ─── MAIN PIPELINE ───────────────────────────────────────────────────────────

  async function runPipeline(capturedUrl: string) {
    dbg('runPipeline: starting...');
    setPhase('processing');
    pushLog('=== pipeline start ===');

    // ── Step 2: bald gen + Step 3: original scan (parallel) ──────────────────
    updateStep('bald_gen',      { status: 'running', detail: 'Sending to the image model for baldification (~15-30s)...' });
    updateStep('original_scan', { status: 'running', detail: 'Sending to FaceLift server (~20s)...' });

    const baldGenStart      = Date.now();
    const originalScanStart = Date.now();

    // Launch original scan immediately
    const originalScanPromise = callFacelift(capturedUrl, 'original', pushLog)
      .then(result => {
        const elapsed = Date.now() - originalScanStart;
        dbg(`runPipeline: original scan done in ${elapsed}ms, jobId=${result.jobId}`);
        pushLog(`[original_scan] done in ${(elapsed / 1000).toFixed(1)}s — jobId=${result.jobId}`);
        updateStep('original_scan', {
          status: 'done',
          detail: `jobId: ${result.jobId}`,
          timing: elapsed,
        });
        setOriginalResult(result);
        return result;
      })
      .catch(err => {
        const msg = err instanceof Error ? err.message : String(err);
        dbgErr(`runPipeline: original scan failed: ${msg}`);
        pushLog(`[original_scan] FAILED: ${msg}`);
        updateStep('original_scan', { status: 'error', error: msg });
        throw new Error(`Original scan failed: ${msg}`);
      });

    // Launch bald generation immediately in parallel
    const baldGenPromise = generateBaldImage(capturedUrl, pushLog)
      .then(async ({ baldDataUrl: baldUrl }) => {
        const baldGenElapsed = Date.now() - baldGenStart;
        dbg(`runPipeline: bald gen done in ${baldGenElapsed}ms`);
        pushLog(`[bald_gen] done in ${(baldGenElapsed / 1000).toFixed(2)}s`);
        updateStep('bald_gen', {
          status: 'done',
          detail: `image model baldification applied`,
          timing: baldGenElapsed,
        });
        setBaldDataUrl(baldUrl);

        // ── Step 4: bald scan — starts right after bald gen ────────────────
        const baldScanStart = Date.now();
        updateStep('bald_scan', { status: 'running', detail: 'Sending bald image to FaceLift (~20s)...' });
        pushLog('[bald_scan] starting bald facelift...');

        const result = await callFacelift(baldUrl, 'bald', pushLog);
        const baldScanElapsed = Date.now() - baldScanStart;
        dbg(`runPipeline: bald scan done in ${baldScanElapsed}ms, jobId=${result.jobId}`);
        pushLog(`[bald_scan] done in ${(baldScanElapsed / 1000).toFixed(1)}s — jobId=${result.jobId}`);
        updateStep('bald_scan', {
          status: 'done',
          detail: `jobId: ${result.jobId}`,
          timing: baldScanElapsed,
        });
        setBaldResult(result);
        return result;
      })
      .catch(err => {
        const msg = err instanceof Error ? err.message : String(err);
        dbgErr(`runPipeline: bald gen or bald scan failed: ${msg}`);
        pushLog(`[bald_gen/bald_scan] FAILED: ${msg}`);
        // Determine which step to mark errored
        updateStep('bald_gen',  (prev => prev.bald_gen.status  === 'running' ? { status: 'error', error: msg } : {})({} as Record<StepId, StepState>));
        updateStep('bald_scan', { status: 'error', error: msg });
        throw new Error(`Bald pipeline failed: ${msg}`);
      });

    // ── Step 3+4: wait for both scans ────────────────────────────────────────
    let origResult: FaceliftResult;
    let blResult:   FaceliftResult;
    try {
      [origResult, blResult] = await Promise.all([originalScanPromise, baldGenPromise]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dbgErr(`runPipeline: parallel scan phase failed: ${msg}`);
      setFatalError(msg);
      setPhase('error');
      return;
    }

    dbg(`runPipeline: both scans complete — original.jobId=${origResult.jobId}, bald.jobId=${blResult.jobId}`);
    pushLog(`=== both scans done ===`);
    pushLog(`original plyUrl: ${origResult.plyUrl.substring(0, 70)}...`);
    pushLog(`bald     plyUrl: ${blResult.plyUrl.substring(0, 70)}...`);

    // ── Step 5: subtract ─────────────────────────────────────────────────────
    updateStep('subtracting', { status: 'running', detail: 'Building voxel map, filtering hair gaussians...' });
    pushLog('[subtracting] starting...');
    const subStart = Date.now();

    let sub: SubtractResult;
    try {
      sub = await callSubtract(origResult.plyUrl, blResult.plyUrl, pushLog);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dbgErr(`runPipeline: subtract failed: ${msg}`);
      pushLog(`[subtracting] FAILED: ${msg}`);
      updateStep('subtracting', { status: 'error', error: msg });
      setFatalError(msg);
      setPhase('error');
      return;
    }

    const subElapsed = Date.now() - subStart;
    dbg(`runPipeline: subtract done in ${subElapsed}ms — keptCount=${sub.keptCount} (${sub.retainedPct}%)`);
    pushLog(`[subtracting] done — kept ${sub.keptCount}/${sub.totalOriginal} gaussians (${sub.retainedPct}%)`);
    pushLog(`[subtracting] voxelSize=${sub.voxelSize.toFixed(5)}, serverMs=${sub.processingMs}`);

    updateStep('subtracting', {
      status: 'done',
      detail: `${sub.keptCount.toLocaleString()} / ${sub.totalOriginal.toLocaleString()} gaussians kept (${sub.retainedPct}%)`,
      timing: subElapsed,
    });
    setSubResult(sub);

    // ── Step 6: done ─────────────────────────────────────────────────────────
    updateStep('done', {
      status: 'done',
      detail: `Hair splat ready — jobId: ${sub.jobId}`,
    });
    pushLog('=== pipeline complete ===');
    dbg('runPipeline: complete!');
    setPhase('done');
  }

  // ─── consent flow ─────────────────────────────────────────────────────────

  async function handleGiveConsent() {
    dbg('handleGiveConsent: saving...');
    setConsentSaving(true);
    try {
      await recordBiometricConsent({ noticeVersion: 'biometric-notice-2026-06-08' });
      setPhase('camera');
    } catch (err) {
      dbgErr('handleGiveConsent failed:', err);
      setFatalError('Could not save consent. Please try again.');
    } finally {
      setConsentSaving(false);
    }
  }

  // ─── restart ──────────────────────────────────────────────────────────────

  function restart() {
    dbg('restart: resetting state');
    setCapturedDataUrl(null);
    setBaldDataUrl(null);
    setOriginalResult(null);
    setBaldResult(null);
    setSubResult(null);
    setFatalError(null);
    setCameraFailed(false);
    setDebugLines([]);
    setSteps(initialSteps());
    setSubScaleX(1.0);
    setSubScaleY(1.0);
    setSubScaleZ(1.0);
    setSubUniformScale(1.0);
    setSubVoxelOverride('');
    setSubMaskClose(0.55);
    setRerunning(false);
    setPhase('camera');
  }

  // ─── re-run subtraction with current params ───────────────────────────────

  async function handleRerunSubtract() {
    if (!originalResult || !baldResult) return;
    dbg('handleRerunSubtract: starting with params...');
    dbg(`  scaleX=${subScaleX} scaleY=${subScaleY} scaleZ=${subScaleZ} uniformScale=${subUniformScale} voxelOverride="${subVoxelOverride}"`);

    const vsOv = subVoxelOverride.trim() !== '' ? parseFloat(subVoxelOverride) : undefined;
    const opts: SubtractOpts = {
      scaleX:            subScaleX,
      scaleY:            subScaleY,
      scaleZ:            subScaleZ,
      uniformScale:      subUniformScale,
      voxelSizeOverride: vsOv,
      maskCloseThreshold: subMaskClose,
    };

    pushLog('=== re-run subtraction ===');
    pushLog(`[rerun] opts: ${JSON.stringify(opts)}`);
    setRerunning(true);
    updateStep('subtracting', { status: 'running', detail: `Re-running with scale=(${subScaleX},${subScaleY},${subScaleZ}) uni=${subUniformScale}${vsOv != null ? ` voxel=${vsOv}` : ''}` });
    updateStep('done', { status: 'pending', detail: undefined });

    const t0 = Date.now();
    try {
      const sub = await callSubtract(originalResult.plyUrl, baldResult.plyUrl, pushLog, opts);
      const elapsed = Date.now() - t0;
      pushLog(`[rerun] done in ${(elapsed / 1000).toFixed(1)}s — kept ${sub.keptCount}/${sub.totalOriginal} (${sub.retainedPct}%)`);
      pushLog(`[rerun] overlap=${sub.overlapCount}, voxelSize=${sub.voxelSize.toFixed(6)}`);
      updateStep('subtracting', { status: 'done', detail: `${sub.keptCount.toLocaleString()} / ${sub.totalOriginal.toLocaleString()} gaussians kept (${sub.retainedPct}%)`, timing: elapsed });
      updateStep('done', { status: 'done', detail: `Re-run complete — jobId: ${sub.jobId}` });
      setSubResult(sub);
      setPhase('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dbgErr(`handleRerunSubtract: failed: ${msg}`);
      pushLog(`[rerun] FAILED: ${msg}`);
      updateStep('subtracting', { status: 'error', error: msg });
    } finally {
      setRerunning(false);
    }
  }

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: '#110e0b', color: '#e8e0d0', fontFamily: 'monospace', display: 'flex', flexDirection: 'column' }}>

      {/* ── header ── */}
      <div style={{ borderBottom: '1px solid #2a2218', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, background: '#0e0c09' }}>
        <Link href="/dashboard" style={{ color: '#887', textDecoration: 'none', fontSize: 12 }}>← dashboard</Link>
        <span style={{ color: '#443' }}>|</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#ffe39a', letterSpacing: '0.08em' }}>
          HAIR EXTRACTION LAB
        </span>
        <span style={{ color: '#443', marginLeft: 'auto', fontSize: 11 }}>/admin/subtraction</span>
      </div>

      <div style={{ flex: 1, display: 'flex', gap: 0, maxWidth: 1100, margin: '0 auto', width: '100%', padding: '24px 16px' }}>

        {/* ── left column: camera / images / result ── */}
        <div style={{ flex: 1, minWidth: 0, marginRight: 20 }}>

          {/* Not signed in */}
          {!isSignedIn && (
            <div style={{ background: '#1c1510', border: '1px solid #3a2c20', padding: 24, marginBottom: 16 }}>
              <p style={{ color: '#ffe39a', marginBottom: 12 }}>Sign in to use this feature.</p>
              <button
                onClick={() => openSignIn()}
                style={{ background: '#d63c2f', color: '#fff', border: 'none', padding: '8px 20px', cursor: 'pointer', fontFamily: 'monospace', fontWeight: 700 }}
              >
                Sign in
              </button>
            </div>
          )}

          {/* ── camera phase ── */}
          {phase === 'camera' && isSignedIn && (
            <div style={{ background: '#1c1510', border: '1px solid #2a2218' }}>
              <video ref={videoRef} muted playsInline style={{ display: 'none' }} />

              {/* Canvas — hidden when camera failed (nothing useful to show) */}
              {!cameraFailed && (
                <canvas
                  ref={canvasRef}
                  width={640}
                  height={640}
                  style={{ width: '100%', aspectRatio: '1/1', display: 'block', background: '#0e0c09' }}
                />
              )}
              {/* Off-screen canvas when camera failed — still needed to draw the uploaded image */}
              {cameraFailed && (
                <canvas
                  ref={canvasRef}
                  width={640}
                  height={640}
                  style={{ display: 'none' }}
                />
              )}

              <div style={{ padding: '16px 20px', borderTop: cameraFailed ? 'none' : '1px solid #2a2218' }}>
                {cameraFailed ? (
                  <p style={{ fontSize: 13, color: '#b0a090', marginBottom: 12 }}>
                    Camera not available. Upload a photo of your face to continue.
                  </p>
                ) : (
                  <p style={{ fontSize: 13, color: '#b0a090', marginBottom: 12 }}>
                    Place your face inside the oval and take a photo, or upload one. A &quot;bald&quot; version will be generated automatically and both will be fed to FaceLift.
                  </p>
                )}

                {!hasBiometricConsent && (
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12, fontSize: 12, color: '#887', cursor: 'pointer', lineHeight: 1.5 }}>
                    <input
                      type="checkbox"
                      checked={consentChecked}
                      onChange={e => setConsentChecked(e.target.checked)}
                      style={{ marginTop: 2 }}
                    />
                    <span>
                      I consent to ShapeUp processing my face photo and derived 3D mesh. I have read the{' '}
                      <Link href="/biometric-notice" style={{ color: '#ffe39a' }}>Biometric Notice</Link> and{' '}
                      <Link href="/privacy" style={{ color: '#ffe39a' }}>Privacy Policy</Link>.
                    </span>
                  </label>
                )}

                {fatalError && (
                  <div style={{ color: '#d63c2f', fontSize: 12, marginBottom: 10, padding: '6px 10px', background: 'rgba(214,60,47,0.08)', border: '1px solid rgba(214,60,47,0.2)' }}>
                    {fatalError}
                  </div>
                )}

                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleUpload}
                />

                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  {!cameraFailed && (
                    <button
                      onClick={handleCapture}
                      disabled={consentSaving || (!hasBiometricConsent && !consentChecked)}
                      style={{
                        background: '#d63c2f',
                        color: '#fff',
                        border: 'none',
                        padding: '10px 28px',
                        cursor: 'pointer',
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        fontSize: 14,
                        opacity: consentSaving || (!hasBiometricConsent && !consentChecked) ? 0.45 : 1,
                      }}
                    >
                      {consentSaving ? 'Saving consent…' : '[ CAPTURE ]'}
                    </button>
                  )}

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={consentSaving || (!hasBiometricConsent && !consentChecked)}
                    style={{
                      background: 'none',
                      color: consentSaving || (!hasBiometricConsent && !consentChecked) ? '#443' : '#ffe39a',
                      border: '1px solid',
                      borderColor: consentSaving || (!hasBiometricConsent && !consentChecked) ? '#2a2218' : '#ffe39a',
                      padding: '10px 20px',
                      cursor: consentSaving || (!hasBiometricConsent && !consentChecked) ? 'not-allowed' : 'pointer',
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      fontSize: 14,
                    }}
                  >
                    ↑ upload image
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── images side by side ── */}
          {capturedDataUrl && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: '#665', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Original</div>
                  <img src={capturedDataUrl} alt="original capture" style={{ width: '100%', display: 'block', border: '1px solid #2a2218' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: '#665', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Bald (generated)</div>
                  {baldDataUrl
                    ? <img src={baldDataUrl} alt="bald version" style={{ width: '100%', display: 'block', border: '1px solid #2a2218' }} />
                    : <div style={{ width: '100%', aspectRatio: '1/1', background: '#1a1610', border: '1px solid #2a2218', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#443' }}>generating…</div>
                  }
                </div>
              </div>
            </div>
          )}

          {/* ── result splat ── */}
          {phase === 'done' && subResult && (
            <div style={{ marginBottom: 16, border: '1px solid #2a2218', background: '#0e0c09' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid #2a2218', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#7ec88b', fontSize: 12, fontWeight: 700 }}>✓ HAIR SPLAT READY</span>
                <span style={{ color: '#443', fontSize: 11 }}>—</span>
                <span style={{ color: '#887', fontSize: 11 }}>
                  {subResult.keptCount.toLocaleString()} gaussians · {subResult.retainedPct}% retained
                </span>
              </div>
              <ErasableSplatViewer plyUrl={subResult.plyUrl} splatUrl={subResult.splatUrl} />
              <div style={{ padding: '10px 14px', borderTop: '1px solid #2a2218', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button
                  onClick={restart}
                  style={{ background: 'none', border: '1px solid #443', color: '#887', padding: '2px 12px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11, marginLeft: 'auto' }}
                >
                  restart
                </button>
              </div>
            </div>
          )}

          {/* ── error phase ── */}
          {phase === 'error' && (
            <div style={{ background: 'rgba(214,60,47,0.06)', border: '1px solid rgba(214,60,47,0.25)', padding: 20, marginBottom: 16 }}>
              <div style={{ color: '#d63c2f', fontWeight: 700, marginBottom: 8 }}>Pipeline failed</div>
              <div style={{ color: '#a86', fontSize: 12, marginBottom: 16, whiteSpace: 'pre-wrap' }}>{fatalError}</div>
              <button
                onClick={restart}
                style={{ background: '#d63c2f', color: '#fff', border: 'none', padding: '8px 20px', cursor: 'pointer', fontFamily: 'monospace', fontWeight: 700 }}
              >
                Try again
              </button>
            </div>
          )}

          {/* ── individual scan splat viewers ── */}
          {(originalResult ?? baldResult) && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: '#665', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Individual 3D Scans</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, border: '1px solid #2a2218', background: '#0e0c09', minWidth: 0 }}>
                  <div style={{ padding: '6px 10px', borderBottom: '1px solid #2a2218', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10, color: '#665', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Original scan</span>
                    {originalResult && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <a href={originalResult.plyUrl} download="original.ply" style={{ fontSize: 10, color: '#ffe39a', textDecoration: 'none' }}>↓ .ply</a>
                        <a href={originalResult.splatUrl} download="original.splat" style={{ fontSize: 10, color: '#ffe39a', textDecoration: 'none' }}>↓ .splat</a>
                      </div>
                    )}
                  </div>
                  {originalResult
                    ? <HairSplatViewer src={originalResult.splatUrl} height={220} />
                    : <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#443', fontFamily: 'monospace' }}>scanning…</div>
                  }
                </div>
                <div style={{ flex: 1, border: '1px solid #2a2218', background: '#0e0c09', minWidth: 0 }}>
                  <div style={{ padding: '6px 10px', borderBottom: '1px solid #2a2218', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10, color: '#665', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Bald scan</span>
                    {baldResult && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <a href={baldResult.plyUrl} download="bald.ply" style={{ fontSize: 10, color: '#ffe39a', textDecoration: 'none' }}>↓ .ply</a>
                        <a href={baldResult.splatUrl} download="bald.splat" style={{ fontSize: 10, color: '#ffe39a', textDecoration: 'none' }}>↓ .splat</a>
                      </div>
                    )}
                  </div>
                  {baldResult
                    ? <HairSplatViewer src={baldResult.splatUrl} height={220} />
                    : <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#443', fontFamily: 'monospace' }}>scanning…</div>
                  }
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── right column: steps + debug ── */}
        <div style={{ width: 320, flexShrink: 0 }}>

          {/* steps */}
          <div style={{ background: '#161209', border: '1px solid #2a2218', padding: '12px 14px', marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: '#665', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Pipeline Steps</div>
            {STEP_ORDER.map(id => <StepRow key={id} step={steps[id]} />)}
          </div>

          {/* stats when done */}
          {subResult && (
            <div style={{ background: '#161209', border: '1px solid #2a2218', padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: '#665', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Subtraction Stats</div>
              {[
                ['Original gaussians', subResult.totalOriginal.toLocaleString()],
                ['Bald gaussians',     subResult.totalBald.toLocaleString()],
                ['Overlap (removed)',  (subResult.overlapCount ?? 0).toLocaleString()],
                ['Streaks removed',    (subResult.closedCount ?? 0).toLocaleString()],
                ['Hair gaussians',     subResult.keptCount.toLocaleString()],
                ['Retained %',        `${subResult.retainedPct}%`],
                ['Voxel size',        subResult.voxelSize.toFixed(6)],
                ['Server time',       `${subResult.processingMs}ms`],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0', borderBottom: '1px solid #1a1610', color: '#887' }}>
                  <span style={{ color: '#665' }}>{k}</span>
                  <span style={{ color: '#ffe39a' }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {/* subtraction param editor — visible once both scans are done */}
          {originalResult && baldResult && (
            <div style={{ background: '#161209', border: '1px solid #3a2c10', padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: '#ffe39a', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Subtraction Controls</div>
              <div style={{ fontSize: 10, color: '#554', marginBottom: 10, lineHeight: 1.6 }}>
                Scale applied to <em>bald</em> PLY coords before voxelizing.<br/>
                {'< 1'} = shrink bald mask (keep more scalp) · {'> 1'} = expand (remove more)
              </div>

              {/* Uniform scale */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#887', marginBottom: 4 }}>
                  <span>Uniform scale</span>
                  <span style={{ color: '#ffe39a', fontFamily: 'monospace' }}>{subUniformScale.toFixed(3)}</span>
                </div>
                <input
                  type="range" min={0.5} max={2.0} step={0.01}
                  value={subUniformScale}
                  onChange={e => setSubUniformScale(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: '#ffe39a' }}
                />
              </div>

              {/* Scale X */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#887', marginBottom: 3 }}>
                  <span>Scale X</span>
                  <span style={{ color: '#ffe39a', fontFamily: 'monospace' }}>{subScaleX.toFixed(3)}</span>
                </div>
                <input
                  type="range" min={0.5} max={2.0} step={0.01}
                  value={subScaleX}
                  onChange={e => setSubScaleX(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: '#d63c2f' }}
                />
              </div>

              {/* Scale Y */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#887', marginBottom: 3 }}>
                  <span>Scale Y</span>
                  <span style={{ color: '#ffe39a', fontFamily: 'monospace' }}>{subScaleY.toFixed(3)}</span>
                </div>
                <input
                  type="range" min={0.5} max={2.0} step={0.01}
                  value={subScaleY}
                  onChange={e => setSubScaleY(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: '#7ec88b' }}
                />
              </div>

              {/* Scale Z */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#887', marginBottom: 3 }}>
                  <span>Scale Z</span>
                  <span style={{ color: '#ffe39a', fontFamily: 'monospace' }}>{subScaleZ.toFixed(3)}</span>
                </div>
                <input
                  type="range" min={0.5} max={2.0} step={0.01}
                  value={subScaleZ}
                  onChange={e => setSubScaleZ(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: '#6ab4d8' }}
                />
              </div>

              {/* Voxel size override */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: '#887', marginBottom: 4 }}>Voxel size override <span style={{ color: '#554' }}>(empty = auto)</span></div>
                <input
                  type="number"
                  min={0.001} max={0.5} step={0.001}
                  value={subVoxelOverride}
                  onChange={e => setSubVoxelOverride(e.target.value)}
                  placeholder={subResult ? `auto: ${subResult.voxelSize.toFixed(6)}` : 'auto'}
                  style={{
                    width: '100%',
                    background: '#0e0c09',
                    border: '1px solid #3a2c10',
                    color: '#ffe39a',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    padding: '5px 8px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Streak cleanup (mask close) */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#887', marginBottom: 3 }}>
                  <span>Streak cleanup <span style={{ color: '#554' }}>(removes face leakage)</span></span>
                  <span style={{ color: '#ffe39a', fontFamily: 'monospace' }}>
                    {subMaskClose >= 1 ? 'off' : subMaskClose.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range" min={0.3} max={1.0} step={0.05}
                  value={subMaskClose}
                  onChange={e => setSubMaskClose(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: '#d8956a' }}
                />
                <div style={{ fontSize: 9, color: '#554', marginTop: 2 }}>
                  lower = more aggressive · 1.00 = disabled
                </div>
              </div>

              {/* Reset + Re-run */}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => { setSubScaleX(1); setSubScaleY(1); setSubScaleZ(1); setSubUniformScale(1); setSubVoxelOverride(''); setSubMaskClose(0.55); }}
                  style={{ flex: 1, background: '#0e0c09', border: '1px solid #443', color: '#665', padding: '6px 0', cursor: 'pointer', fontFamily: 'monospace', fontSize: 10 }}
                >
                  reset
                </button>
                <button
                  onClick={handleRerunSubtract}
                  disabled={rerunning}
                  style={{
                    flex: 2,
                    background: rerunning ? '#1a1408' : '#3a2c10',
                    border: '1px solid #ffe39a',
                    color: rerunning ? '#665' : '#ffe39a',
                    padding: '6px 0',
                    cursor: rerunning ? 'not-allowed' : 'pointer',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {rerunning ? 'running…' : '[ RE-RUN SUBTRACTION ]'}
                </button>
              </div>
            </div>
          )}

          {/* debug console */}
          <div style={{ background: '#0a0805', border: '1px solid #2a2218' }}>
            <div style={{ fontSize: 10, color: '#665', padding: '6px 10px', borderBottom: '1px solid #2a2218', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'flex', justifyContent: 'space-between' }}>
              <span>Debug Console</span>
              <span style={{ color: '#443' }}>{debugLines.length} lines</span>
            </div>
            <div style={{ height: 280, overflowY: 'auto', padding: '6px 10px', fontSize: 10, lineHeight: 1.6, fontFamily: 'monospace', color: '#665' }}>
              {debugLines.length === 0 && (
                <span style={{ color: '#332' }}>Waiting for pipeline to start…</span>
              )}
              {debugLines.map((line, i) => (
                <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', borderBottom: '1px solid #110e0b' }}>{line}</div>
              ))}
              <div ref={debugEndRef} />
            </div>
          </div>

          {/* test runner button */}
          <div style={{ marginTop: 8 }}>
            <button
              onClick={async () => {
                pushLog('[test-runner] calling GET /api/admin/subtraction/subtract/test...');
                try {
                  const res  = await fetch('/api/admin/subtraction/subtract');
                  const data = await res.json() as { allPassed: boolean; results: { name: string; passed: boolean; error?: string }[] };
                  pushLog(`[test-runner] allPassed=${data.allPassed}`);
                  data.results.forEach(r => {
                    pushLog(`  ${r.passed ? '✓' : '✕'} ${r.name}${r.error ? ` — ${r.error}` : ''}`);
                  });
                } catch (e) {
                  pushLog(`[test-runner] FAILED: ${e instanceof Error ? e.message : String(e)}`);
                }
              }}
              style={{
                width: '100%',
                background: '#161209',
                border: '1px solid #2a2218',
                color: '#887',
                padding: '7px 0',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: 11,
              }}
            >
              Run API Tests (GET /api/admin/subtraction/subtract)
            </button>
          </div>
        </div>
      </div>

      {/* ── how it works footer ── */}
      <div style={{ borderTop: '1px solid #2a2218', padding: '14px 24px', background: '#0e0c09', fontSize: 11, color: '#443', lineHeight: 1.8 }}>
        <strong style={{ color: '#665' }}>How it works:</strong>
        {' '}(1) capture photo → (2) the image model removes hair to generate a bald version → (3) both images go through FaceLift 3D reconstruction → (4) server-side voxel subtraction keeps only gaussians present in original but absent in bald version → (5) result converted to .splat and rendered in-browser
      </div>
    </div>
  );
}
