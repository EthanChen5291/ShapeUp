'use client';

// /alignment — Hair-on-Head Alignment Lab
// Flow (NO subtraction, NO fetch — the hair ply is uploaded by the user):
//  0. Upload    — user supplies a hair ply (.ply); parsed + splatted in-browser
//  1. Capture   — user takes / uploads a photo
//  2. Baldify   — Gemini removes the hair → bald photo
//  3. Scan      — bald photo runs through FaceLift → head ply
//  4. Align     — snap the uploaded hair ply onto the head ply via SIX strategies
//  5. Done      — render head + hair together; switch/tune the alignment live

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useUser, useClerk } from '@clerk/nextjs';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import Link from 'next/link';
import { parsePly, buildSplatBlob } from '../subtraction/plyUtils';
import {
  solveAll, DEFAULT_OPTIONS,
  type AlignTransform, type AlignOptions, type Axis,
} from './alignmentMath';
import type { ManualNudge } from './AlignmentViewer';

const AlignmentViewer = dynamic(() => import('./AlignmentViewer'), { ssr: false });

const TAG = '[alignment]';
function dbg(msg: string, ...args: unknown[]) { console.log(`${TAG} ${new Date().toISOString()} ${msg}`, ...args); }
function dbgErr(msg: string, ...args: unknown[]) { console.error(`${TAG} ERROR: ${msg}`, ...args); }

// ─── types ────────────────────────────────────────────────────────────────────

type StepId = 'capture' | 'bald_gen' | 'head_scan' | 'aligning' | 'done';
type StepStatus = 'pending' | 'running' | 'done' | 'error';
type Phase = 'camera' | 'processing' | 'done' | 'error';

interface StepState { status: StepStatus; label: string; detail?: string; timing?: number; error?: string; }
interface FaceliftResult { jobId: string; plyUrl: string; splatUrl: string; }
interface HairData { positions: Float32Array; splatUrl: string; count: number; name: string; }

const STEP_ORDER: StepId[] = ['capture', 'bald_gen', 'head_scan', 'aligning', 'done'];

function initialSteps(): Record<StepId, StepState> {
  return {
    capture:   { status: 'pending', label: '1 · Capture' },
    bald_gen:  { status: 'pending', label: '2 · Baldify (Gemini)' },
    head_scan: { status: 'pending', label: '3 · Scan bald → head ply' },
    aligning:  { status: 'pending', label: '4 · Align hair onto head' },
    done:      { status: 'pending', label: '5 · Head + hair in 3D' },
  };
}

// ─── pipeline callers (mirror /subtraction) ─────────────────────────────────────

async function generateBaldImage(imageDataUrl: string, log: (s: string) => void): Promise<string> {
  log('sending image to Gemini for baldify (~15-30s)...');
  const res = await fetch('/api/baldify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl }),
  });
  if (!res.ok) throw new Error(`Gemini baldify failed: HTTP ${res.status} — ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = await res.json() as { baldifiedDataUrl?: string; error?: string };
  if (data.error || !data.baldifiedDataUrl) throw new Error(data.error ?? 'Gemini returned no image');
  return data.baldifiedDataUrl;
}

async function callFacelift(imageDataUrl: string, tag: string, log: (s: string) => void): Promise<FaceliftResult> {
  log(`[${tag}] → /api/facelift (${imageDataUrl.length} chars)`);
  const res = await fetch('/api/facelift', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    // Alignment parses ply positions (fetchPositions), so it needs the raw .ply —
    // opt in explicitly (the API skips the .ply upload unless needPly is true).
    body: JSON.stringify({ imageDataUrl, outputName: `alignment-${tag}`, needPly: true }),
  });
  if (!res.ok) throw new Error(`[${tag}] HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = await res.json() as Partial<FaceliftResult> & { error?: string };
  if (data.error || !data.jobId || !data.plyUrl || !data.splatUrl) throw new Error(data.error ?? `[${tag}] invalid facelift response`);
  return data as FaceliftResult;
}

async function fetchPositions(plyUrl: string, log: (s: string) => void): Promise<Float32Array> {
  log(`fetching PLY ${plyUrl.slice(0, 50)}...`);
  const res = await fetch(plyUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching PLY`);
  const g = parsePly(await res.arrayBuffer());
  log(`parsed ${g.count.toLocaleString()} gaussians`);
  return g.positions;
}

// ─── camera overlay (mirrors /subtraction) ──────────────────────────────────────

function drawOverlay(ctx: CanvasRenderingContext2D, W: number, H: number, captured: boolean) {
  const cx = W / 2, cy = H * 0.46, rx = W * 0.32, ry = H * 0.40;
  ctx.save();
  ctx.fillStyle = 'rgba(35,27,20,0.04)';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = captured ? '#ffe39a' : '#d63c2f';
  ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// ─── step row ────────────────────────────────────────────────────────────────────

function StepRow({ step }: { step: StepState }) {
  const icon = step.status === 'pending' ? '○' : step.status === 'running' ? '◉' : step.status === 'done' ? '✓' : '✕';
  const color = step.status === 'pending' ? '#665' : step.status === 'running' ? '#ffe39a' : step.status === 'done' ? '#7ec88b' : '#d63c2f';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ color, fontFamily: 'monospace', fontSize: 16, minWidth: 18, lineHeight: '22px' }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ color, fontFamily: 'monospace', fontSize: 13, fontWeight: 700 }}>{step.label}</div>
        {step.detail && <div style={{ color: '#887', fontFamily: 'monospace', fontSize: 11, marginTop: 2 }}>{step.detail}</div>}
        {step.timing != null && <div style={{ color: '#665', fontFamily: 'monospace', fontSize: 10, marginTop: 1 }}>{(step.timing / 1000).toFixed(1)}s</div>}
        {step.error && <div style={{ color: '#d63c2f', fontFamily: 'monospace', fontSize: 11, marginTop: 3, whiteSpace: 'pre-wrap' }}>{step.error}</div>}
      </div>
    </div>
  );
}

const ZERO_NUDGE: ManualNudge = { dx: 0, dy: 0, dz: 0, scale: 1 };

// ─── main component ───────────────────────────────────────────────────────────────

export default function AlignmentPage() {
  const { isSignedIn } = useUser();
  const { openSignIn } = useClerk();
  const convexUser = useQuery(api.users.getMe);
  const recordBiometricConsent = useMutation(api.users.recordBiometricConsent);

  const [phase, setPhase] = useState<Phase>('camera');
  const [steps, setSteps] = useState<Record<StepId, StepState>>(initialSteps);
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentSaving, setConsentSaving] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [debugLines, setDebugLines] = useState<string[]>([]);

  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [baldDataUrl, setBaldDataUrl] = useState<string | null>(null);
  const [headResult, setHeadResult] = useState<FaceliftResult | null>(null);  // bald scan = head ply
  const [hairData, setHairData] = useState<HairData | null>(null);            // prebaked hair ply

  // alignment state
  const [transforms, setTransforms] = useState<AlignTransform[] | null>(null);
  const [activeId, setActiveId] = useState<string>('icp');
  const [nudge, setNudge] = useState<ManualNudge>(ZERO_NUDGE);
  const [showHead, setShowHead] = useState(true);
  const [showHair, setShowHair] = useState(true);
  const [solid, setSolid] = useState(true); // depth-occlude splats so neither shows through the other
  const [upAxis, setUpAxis] = useState<Axis>('y');
  const [upSign, setUpSign] = useState<1 | -1>(1);

  // raw position buffers kept for re-solving when options change
  const hairPosRef = useRef<Float32Array | null>(null);
  const headPosRef = useRef<Float32Array | null>(null);
  const hairBlobUrlRef = useRef<string | null>(null); // for cleanup of the hair .splat blob

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hairInputRef = useRef<HTMLInputElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const debugEndRef = useRef<HTMLDivElement>(null);

  const hasBiometricConsent = Boolean(convexUser?.biometricConsentAt);

  const pushLog = useCallback((msg: string) => {
    const ts = new Date().toISOString().slice(11, 23);
    setDebugLines(prev => [...prev.slice(-299), `${ts}  ${msg}`]);
  }, []);

  useEffect(() => { debugEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [debugLines]);

  const updateStep = useCallback((id: StepId, update: Partial<StepState>) => {
    setSteps(prev => ({ ...prev, [id]: { ...prev[id], ...update } }));
  }, []);

  // ─── camera ──────────────────────────────────────────────────────────────────

  const drawFrame = useCallback(() => {
    if (!activeRef.current) return;
    const video = videoRef.current, canvas = canvasRef.current;
    if (video && canvas && video.readyState >= 2) {
      const ctx = canvas.getContext('2d')!;
      const W = 640, H = 640;
      const vW = video.videoWidth || 640, vH = video.videoHeight || 480;
      const crop = Math.min(vW, vH), cropX = (vW - crop) / 2, cropY = (vH - crop) / 2;
      ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1);
      ctx.drawImage(video, cropX, cropY, crop, crop, 0, 0, W, H);
      ctx.restore();
      drawOverlay(ctx, W, H, false);
    }
    animFrameRef.current = requestAnimationFrame(drawFrame);
  }, []);

  useEffect(() => {
    if (phase !== 'camera') return;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 1280, height: 960 }, audio: false });
        const video = videoRef.current!;
        video.srcObject = stream;
        video.setAttribute('playsinline', '');
        await video.play();
        activeRef.current = true;
        animFrameRef.current = requestAnimationFrame(drawFrame);
      } catch (err) {
        dbgErr('getUserMedia failed:', err);
        setFatalError(`Camera access denied: ${err instanceof Error ? err.message : String(err)}`);
        setPhase('error');
      }
    })();
    return () => {
      activeRef.current = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [phase, drawFrame]);

  // ─── capture + pipeline ────────────────────────────────────────────────────────

  async function ensureConsent(): Promise<boolean> {
    if (!isSignedIn) { openSignIn(); return false; }
    if (!hasBiometricConsent) {
      if (!consentChecked) { setFatalError('Please check the biometric consent box before scanning.'); return false; }
      setConsentSaving(true);
      try { await recordBiometricConsent({ noticeVersion: 'biometric-notice-2026-06-08' }); }
      catch { setFatalError('Could not save consent. Please try again.'); return false; }
      finally { setConsentSaving(false); }
    }
    return true;
  }

  // Decode an uploaded image and center-crop it to a 640×640 PNG, matching the
  // camera-capture format FaceLift expects (no mirror flip for uploads).
  async function fileToSquareDataUrl(file: File): Promise<string> {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('Could not decode image'));
        im.src = url;
      });
      const W = 640, H = 640;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d')!;
      const crop = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - crop) / 2, sy = (img.naturalHeight - crop) / 2;
      ctx.drawImage(img, sx, sy, crop, crop, 0, 0, W, H);
      return c.toDataURL('image/png');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Read the user's hair .ply entirely in-browser: parse gaussians for alignment and
  // build a .splat blob URL for the viewer. Nothing is fetched from the network.
  async function handleHairUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const g = parsePly(await file.arrayBuffer());
      if (g.count === 0) throw new Error('PLY has no vertices');
      if (hairBlobUrlRef.current) URL.revokeObjectURL(hairBlobUrlRef.current);
      const splatUrl = URL.createObjectURL(buildSplatBlob(g, new Set<number>()));
      hairBlobUrlRef.current = splatUrl;
      setHairData({ positions: g.positions, splatUrl, count: g.count, name: file.name });
      setFatalError(null);
      pushLog(`hair ply loaded: ${file.name} — ${g.count.toLocaleString()} gaussians`);
    } catch (err) {
      setFatalError(`Could not read hair PLY: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    if (!file.type.startsWith('image/')) { setFatalError('Please choose an image file.'); return; }
    if (!(await ensureConsent())) return;

    let dataUrl: string;
    try { dataUrl = await fileToSquareDataUrl(file); }
    catch (err) { setFatalError(err instanceof Error ? err.message : 'Could not read image'); return; }

    // Tear down the live camera (the pipeline phase change also triggers cleanup).
    activeRef.current = false;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    (videoRef.current?.srcObject as MediaStream | null)?.getTracks().forEach(t => t.stop());

    setCapturedDataUrl(dataUrl);
    updateStep('capture', { status: 'done', detail: `uploaded ${file.name}` });
    runPipeline(dataUrl);
  }

  async function handleCapture() {
    if (!(await ensureConsent())) return;

    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas) return;
    activeRef.current = false;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    const W = 640, H = 640;
    const ctx = canvas.getContext('2d')!;
    const vW = video.videoWidth || 640, vH = video.videoHeight || 480;
    const crop = Math.min(vW, vH), cropX = (vW - crop) / 2, cropY = (vH - crop) / 2;
    ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, cropX, cropY, crop, crop, 0, 0, W, H);
    ctx.restore();
    const dataUrl = canvas.toDataURL('image/png');
    drawOverlay(ctx, W, H, true);
    (video.srcObject as MediaStream | null)?.getTracks().forEach(t => t.stop());

    setCapturedDataUrl(dataUrl);
    updateStep('capture', { status: 'done', detail: `${W}×${H} PNG captured` });
    runPipeline(dataUrl);
  }

  async function runPipeline(capturedUrl: string) {
    const hair = hairData;
    if (!hair) { setFatalError('Please upload a hair ply (.ply) before scanning.'); return; }

    setPhase('processing');
    pushLog('=== pipeline start ===');
    pushLog(`hair ply: ${hair.name} — ${hair.count.toLocaleString()} gaussians (uploaded)`);

    // ── head ply: baldify the photo, then FaceLift the bald image ──
    let head: FaceliftResult;
    try {
      updateStep('bald_gen', { status: 'running', detail: 'Gemini baldify (~15-30s)...' });
      const baldStart = Date.now();
      const baldUrl = await generateBaldImage(capturedUrl, pushLog);
      updateStep('bald_gen', { status: 'done', detail: 'bald photo ready', timing: Date.now() - baldStart });
      setBaldDataUrl(baldUrl);

      updateStep('head_scan', { status: 'running', detail: 'FaceLift bald (~20s)...' });
      const scanStart = Date.now();
      head = await callFacelift(baldUrl, 'bald', pushLog);
      updateStep('head_scan', { status: 'done', detail: `jobId: ${head.jobId}`, timing: Date.now() - scanStart });
      setHeadResult(head);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setSteps(prev => {
        const next = { ...prev };
        if (next.bald_gen.status === 'running') next.bald_gen = { ...next.bald_gen, status: 'error', error: m };
        else if (next.head_scan.status === 'running') next.head_scan = { ...next.head_scan, status: 'error', error: m };
        return next;
      });
      setFatalError(m); setPhase('error'); return;
    }

    pushLog('=== head ready ===');

    // ── align: parse the head cloud, run all six solutions (hair already parsed) ──
    updateStep('aligning', { status: 'running', detail: 'Parsing head + solving 6 alignments...' });
    const alignStart = Date.now();
    try {
      const headPos = await fetchPositions(head.plyUrl, pushLog);
      hairPosRef.current = hair.positions;
      headPosRef.current = headPos;
      const opts: AlignOptions = { ...DEFAULT_OPTIONS, upAxis, upSign };
      const results = solveAll(hair.positions, headPos, opts);
      setTransforms(results);
      results.forEach(t => pushLog(`  ${t.label}${t.meta ? ` — ${Object.entries(t.meta).map(([k, v]) => `${k}=${v}`).join(' ')}` : ''}`));
      updateStep('aligning', { status: 'done', detail: `6 solutions ready`, timing: Date.now() - alignStart });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      updateStep('aligning', { status: 'error', error: m });
      setFatalError(m); setPhase('error'); return;
    }

    updateStep('done', { status: 'done', detail: 'Head + hair aligned' });
    pushLog('=== pipeline complete ===');
    setPhase('done');
  }

  // ─── re-solve when up-axis options change (no re-scan needed) ────────────────────

  const resolve = useCallback((nextAxis: Axis, nextSign: 1 | -1) => {
    const hairPos = hairPosRef.current, headPos = headPosRef.current;
    if (!hairPos || !headPos) return;
    const opts: AlignOptions = { ...DEFAULT_OPTIONS, upAxis: nextAxis, upSign: nextSign };
    pushLog(`re-solving with up=${nextSign > 0 ? '+' : '-'}${nextAxis}`);
    setTransforms(solveAll(hairPos, headPos, opts));
    setNudge(ZERO_NUDGE);
  }, [pushLog]);

  function restart() {
    // Keep the uploaded hair ply loaded so a re-scan doesn't need a re-upload.
    setCapturedDataUrl(null); setBaldDataUrl(null); setHeadResult(null);
    setTransforms(null); setNudge(ZERO_NUDGE); setActiveId('icp');
    setFatalError(null); setDebugLines([]); setSteps(initialSteps());
    headPosRef.current = null;
    setPhase('camera');
  }

  const activeTransform = transforms?.find(t => t.id === activeId) ?? transforms?.[0] ?? null;

  // ─── render ───────────────────────────────────────────────────────────────────

  const slider = (label: string, value: number, set: (n: number) => void, min: number, max: number, step: number, accent: string) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#887', marginBottom: 3 }}>
        <span>{label}</span><span style={{ color: '#ffe39a', fontFamily: 'monospace' }}>{value.toFixed(3)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => set(parseFloat(e.target.value))} style={{ width: '100%', accentColor: accent }} />
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#110e0b', color: '#e8e0d0', fontFamily: 'monospace', display: 'flex', flexDirection: 'column' }}>
      <div style={{ borderBottom: '1px solid #2a2218', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, background: '#0e0c09' }}>
        <Link href="/dashboard" style={{ color: '#887', textDecoration: 'none', fontSize: 12 }}>← dashboard</Link>
        <span style={{ color: '#443' }}>|</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#ffe39a', letterSpacing: '0.08em' }}>HAIR ALIGNMENT LAB</span>
        <Link href="/subtraction" style={{ color: '#665', textDecoration: 'none', fontSize: 11, marginLeft: 12 }}>subtraction →</Link>
        <span style={{ color: '#443', marginLeft: 'auto', fontSize: 11 }}>/alignment</span>
      </div>

      <div style={{ flex: 1, display: 'flex', gap: 0, maxWidth: 1180, margin: '0 auto', width: '100%', padding: '24px 16px' }}>
        {/* ── left column ── */}
        <div style={{ flex: 1, minWidth: 0, marginRight: 20 }}>
          {!isSignedIn && (
            <div style={{ background: '#1c1510', border: '1px solid #3a2c20', padding: 24, marginBottom: 16 }}>
              <p style={{ color: '#ffe39a', marginBottom: 12 }}>Sign in to use this feature.</p>
              <button onClick={() => openSignIn()} style={{ background: '#d63c2f', color: '#fff', border: 'none', padding: '8px 20px', cursor: 'pointer', fontFamily: 'monospace', fontWeight: 700 }}>Sign in</button>
            </div>
          )}

          {phase === 'camera' && isSignedIn && (
            <div style={{ background: '#1c1510', border: '1px solid #2a2218' }}>
              <video ref={videoRef} muted playsInline style={{ display: 'none' }} />
              <canvas ref={canvasRef} width={640} height={640} style={{ width: '100%', aspectRatio: '1/1', display: 'block', background: '#0e0c09' }} />
              <div style={{ padding: '16px 20px', borderTop: '1px solid #2a2218' }}>
                <p style={{ fontSize: 13, color: '#b0a090', marginBottom: 12 }}>
                  Upload your hair ply, then take or upload a photo. Gemini makes a bald version, FaceLift reconstructs the head, and your uploaded hair ply is snapped onto it — six different ways. No subtraction, no fetch.
                </p>

                {/* ── step 0: upload hair ply (parsed in-browser, never fetched) ── */}
                <div style={{ marginBottom: 14, padding: '10px 12px', background: '#13100a', border: `1px solid ${hairData ? '#3a4a2c' : '#3a2c10'}` }}>
                  <div style={{ fontSize: 11, color: hairData ? '#7ec88b' : '#ffe39a', marginBottom: 7 }}>
                    {hairData
                      ? `✓ Hair ply: ${hairData.name} — ${hairData.count.toLocaleString()} gaussians`
                      : 'Step 0 · Upload your hair ply (.ply)'}
                  </div>
                  <input ref={hairInputRef} type="file" accept=".ply,application/octet-stream" onChange={handleHairUpload} style={{ display: 'none' }} />
                  <button onClick={() => hairInputRef.current?.click()}
                    style={{ background: 'none', color: '#ffe39a', border: '1px solid #ffe39a', padding: '6px 16px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12 }}>
                    {hairData ? '[ replace hair ply ]' : '[ choose hair ply .ply ]'}
                  </button>
                </div>

                {!hasBiometricConsent && (
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12, fontSize: 12, color: '#887', cursor: 'pointer', lineHeight: 1.5 }}>
                    <input type="checkbox" checked={consentChecked} onChange={e => setConsentChecked(e.target.checked)} style={{ marginTop: 2 }} />
                    <span>I consent to ShapeUp processing my face photo and derived 3D mesh. I have read the{' '}
                      <Link href="/biometric-notice" style={{ color: '#ffe39a' }}>Biometric Notice</Link> and{' '}
                      <Link href="/privacy" style={{ color: '#ffe39a' }}>Privacy Policy</Link>.</span>
                  </label>
                )}
                {fatalError && <div style={{ color: '#d63c2f', fontSize: 12, marginBottom: 10, padding: '6px 10px', background: 'rgba(214,60,47,0.08)', border: '1px solid rgba(214,60,47,0.2)' }}>{fatalError}</div>}
                {(() => {
                  const photoDisabled = consentSaving || !hairData || (!hasBiometricConsent && !consentChecked);
                  return (
                    <>
                      {!hairData && <div style={{ fontSize: 11, color: '#a86', marginBottom: 8 }}>Upload a hair ply above to enable the photo step.</div>}
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <button onClick={handleCapture} disabled={photoDisabled}
                          style={{ background: '#d63c2f', color: '#fff', border: 'none', padding: '10px 28px', cursor: photoDisabled ? 'not-allowed' : 'pointer', fontFamily: 'monospace', fontWeight: 700, fontSize: 14, opacity: photoDisabled ? 0.45 : 1 }}>
                          {consentSaving ? 'Saving consent…' : '[ CAPTURE ]'}
                        </button>
                        <button onClick={() => { if (!isSignedIn) { openSignIn(); return; } fileInputRef.current?.click(); }}
                          disabled={photoDisabled}
                          style={{ background: 'none', color: '#ffe39a', border: '1px solid #ffe39a', padding: '10px 22px', cursor: photoDisabled ? 'not-allowed' : 'pointer', fontFamily: 'monospace', fontWeight: 700, fontSize: 14, opacity: photoDisabled ? 0.45 : 1 }}>
                          [ UPLOAD PHOTO ]
                        </button>
                        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUpload} style={{ display: 'none' }} />
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ── images ── */}
          {capturedDataUrl && (
            <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: '#665', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Original</div>
                <img src={capturedDataUrl} alt="original" style={{ width: '100%', display: 'block', border: '1px solid #2a2218' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: '#665', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Bald (Gemini)</div>
                {baldDataUrl
                  ? <img src={baldDataUrl} alt="bald" style={{ width: '100%', display: 'block', border: '1px solid #2a2218' }} />
                  : <div style={{ width: '100%', aspectRatio: '1/1', background: '#1a1610', border: '1px solid #2a2218', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#443' }}>generating…</div>}
              </div>
            </div>
          )}

          {/* ── combined viewer ── */}
          {phase === 'done' && headResult && hairData && activeTransform && (
            <div style={{ marginBottom: 16, border: '1px solid #2a2218', background: '#0e0c09' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid #2a2218', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ color: '#7ec88b', fontSize: 12, fontWeight: 700 }}>✓ HEAD + HAIR</span>
                <span style={{ color: '#887', fontSize: 11 }}>— {activeTransform.label}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
                  <label style={{ fontSize: 10, color: '#887', display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={showHead} onChange={e => setShowHead(e.target.checked)} /> head
                  </label>
                  <label style={{ fontSize: 10, color: '#887', display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={showHair} onChange={e => setShowHair(e.target.checked)} /> hair
                  </label>
                  <label style={{ fontSize: 10, color: solid ? '#7ec88b' : '#887', display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }} title="Depth-occlude so neither splat shows through the other">
                    <input type="checkbox" checked={solid} onChange={e => setSolid(e.target.checked)} /> solid
                  </label>
                </div>
              </div>
              <AlignmentViewer
                headSplatUrl={headResult.splatUrl}
                hairSplatUrl={hairData.splatUrl}
                transform={activeTransform}
                nudge={nudge}
                showHead={showHead}
                showHair={showHair}
                alphaHash={solid}
              />
              <div style={{ padding: '8px 14px', borderTop: '1px solid #2a2218', color: '#887', fontSize: 11, lineHeight: 1.5 }}>
                {activeTransform.description}
              </div>
            </div>
          )}

          {phase === 'error' && (
            <div style={{ background: 'rgba(214,60,47,0.06)', border: '1px solid rgba(214,60,47,0.25)', padding: 20, marginBottom: 16 }}>
              <div style={{ color: '#d63c2f', fontWeight: 700, marginBottom: 8 }}>Pipeline failed</div>
              <div style={{ color: '#a86', fontSize: 12, marginBottom: 16, whiteSpace: 'pre-wrap' }}>{fatalError}</div>
              <button onClick={restart} style={{ background: '#d63c2f', color: '#fff', border: 'none', padding: '8px 20px', cursor: 'pointer', fontFamily: 'monospace', fontWeight: 700 }}>Try again</button>
            </div>
          )}
        </div>

        {/* ── right column ── */}
        <div style={{ width: 340, flexShrink: 0 }}>
          <div style={{ background: '#161209', border: '1px solid #2a2218', padding: '12px 14px', marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: '#665', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Pipeline Steps</div>
            {STEP_ORDER.map(id => <StepRow key={id} step={steps[id]} />)}
          </div>

          {/* ── solution switcher ── */}
          {transforms && (
            <div style={{ background: '#161209', border: '1px solid #3a2c10', padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: '#ffe39a', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Alignment Solution</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {transforms.map(t => {
                  const active = t.id === activeId;
                  return (
                    <button key={t.id} onClick={() => { setActiveId(t.id); setNudge(ZERO_NUDGE); }}
                      style={{ textAlign: 'left', background: active ? '#3a2c10' : '#0e0c09', border: `1px solid ${active ? '#ffe39a' : '#443'}`, color: active ? '#ffe39a' : '#887', padding: '6px 9px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11, fontWeight: active ? 700 : 400 }}>
                      <div>{t.label}</div>
                      {t.meta && <div style={{ fontSize: 9, color: active ? '#a89048' : '#554', marginTop: 2 }}>{Object.entries(t.meta).map(([k, v]) => `${k}:${v}`).join('  ')}</div>}
                    </button>
                  );
                })}
              </div>

              {/* up-axis controls — re-solves the geometric methods */}
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #2a2218' }}>
                <div style={{ fontSize: 10, color: '#887', marginBottom: 6 }}>Crown / up axis <span style={{ color: '#554' }}>(for solutions 3–6)</span></div>
                <div style={{ display: 'flex', gap: 5 }}>
                  {(['x', 'y', 'z'] as Axis[]).map(ax => (
                    <button key={ax} onClick={() => { setUpAxis(ax); resolve(ax, upSign); }}
                      style={{ flex: 1, background: upAxis === ax ? '#3a2c10' : '#0e0c09', border: `1px solid ${upAxis === ax ? '#ffe39a' : '#443'}`, color: upAxis === ax ? '#ffe39a' : '#665', padding: '4px 0', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}>{ax}</button>
                  ))}
                  <button onClick={() => { const s = (upSign * -1) as 1 | -1; setUpSign(s); resolve(upAxis, s); }}
                    style={{ flex: 1, background: '#0e0c09', border: '1px solid #443', color: '#887', padding: '4px 0', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}>{upSign > 0 ? '+' : '−'}</button>
                </div>
              </div>
            </div>
          )}

          {/* ── manual nudge ── */}
          {transforms && (
            <div style={{ background: '#161209', border: '1px solid #2a2218', padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: '#ffe39a', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Manual Nudge</div>
              {slider('offset X', nudge.dx, v => setNudge(n => ({ ...n, dx: v })), -1, 1, 0.005, '#d63c2f')}
              {slider('offset Y', nudge.dy, v => setNudge(n => ({ ...n, dy: v })), -1, 1, 0.005, '#7ec88b')}
              {slider('offset Z', nudge.dz, v => setNudge(n => ({ ...n, dz: v })), -1, 1, 0.005, '#6ab4d8')}
              {slider('scale', nudge.scale, v => setNudge(n => ({ ...n, scale: v })), 0.4, 2.0, 0.01, '#ffe39a')}
              <button onClick={() => setNudge(ZERO_NUDGE)} style={{ width: '100%', background: '#0e0c09', border: '1px solid #443', color: '#665', padding: '5px 0', cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, marginTop: 4 }}>reset nudge</button>
            </div>
          )}

          {phase === 'done' && (
            <button onClick={restart} style={{ width: '100%', background: '#161209', border: '1px solid #2a2218', color: '#887', padding: '7px 0', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11, marginBottom: 12 }}>restart</button>
          )}

          {/* ── debug console ── */}
          <div style={{ background: '#0a0805', border: '1px solid #2a2218' }}>
            <div style={{ fontSize: 10, color: '#665', padding: '6px 10px', borderBottom: '1px solid #2a2218', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'flex', justifyContent: 'space-between' }}>
              <span>Debug Console</span><span style={{ color: '#443' }}>{debugLines.length} lines</span>
            </div>
            <div style={{ height: 240, overflowY: 'auto', padding: '6px 10px', fontSize: 10, lineHeight: 1.6, fontFamily: 'monospace', color: '#665' }}>
              {debugLines.length === 0 && <span style={{ color: '#332' }}>Waiting for pipeline…</span>}
              {debugLines.map((line, i) => <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', borderBottom: '1px solid #110e0b' }}>{line}</div>)}
              <div ref={debugEndRef} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid #2a2218', padding: '14px 24px', background: '#0e0c09', fontSize: 11, color: '#443', lineHeight: 1.8 }}>
        <strong style={{ color: '#665' }}>Six alignment solutions:</strong>{' '}
        (1) raw overlay · (2) centroid match · (3) crown snap · (4) scale-to-fit + crown · (5) PCA axis align · (6) ICP refine. Switch between them above to see the hair ply connect to the bald head ply differently.
      </div>
    </div>
  );
}
