'use client';

import { useClerk, useUser } from '@clerk/nextjs';
import { useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import { buildCurrentProfilePayload } from '@/lib/llmPayload';
import { useCallback, useEffect, useRef, useState } from 'react';

import { UserHeadProfile } from '@/types';

interface ScanCameraProps {
  hairType: 'straight' | 'wavy' | 'curly';
  onScanComplete: (profile: UserHeadProfile, sessionId: string | null, imageUrl: string | null) => void;
  onDataUrlReady?: (dataUrl: string) => void;
  onDismiss: () => void;
  onNoTokens?: () => void;
  paywallDisabled?: boolean;
}

type Phase = 'loading' | 'ready' | 'captured' | 'error';

function drawOverlay(ctx: CanvasRenderingContext2D, W: number, H: number, captured: boolean) {
  const cx = W / 2;
  const cy = H * 0.46;
  const rx = W * 0.32;
  const ry = H * 0.40;

  // featherlight edge tint
  ctx.save();
  ctx.fillStyle = 'rgba(35, 27, 20, 0.04)';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Wonky hand-drawn oval outline (two passes slightly offset)
  ctx.save();
  ctx.strokeStyle = captured ? '#ffe39a' : '#d63c2f';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  // second wobble pass
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(cx + 1, cy - 1, rx - 1, ry + 1, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // "hand drawn" corner brackets
  ctx.strokeStyle = '#fff5dc';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  const bracket = 22;
  const pad = 14;
  [[pad, pad], [W - pad, pad], [pad, H - pad], [W - pad, H - pad]].forEach(([x, y], idx) => {
    const dx = idx % 2 === 0 ? 1 : -1;
    const dy = idx < 2 ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(x, y + dy * bracket);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * bracket, y);
    ctx.stroke();
  });

  // tiny scissor-tick marks at cardinal points
  ctx.strokeStyle = '#ffe39a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 6, cy - ry - 10); ctx.lineTo(cx + 6, cy - ry - 10);
  ctx.moveTo(cx - 6, cy + ry + 10); ctx.lineTo(cx + 6, cy + ry + 10);
  ctx.stroke();
}

export default function ScanCamera({ hairType, onScanComplete, onDataUrlReady, onDismiss, onNoTokens, paywallDisabled = false }: ScanCameraProps) {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const animFrameId   = useRef<number | null>(null);
  const activeRef     = useRef(false);

  const { isSignedIn } = useUser();
  const { openSignIn } = useClerk();
  const convexUser = useQuery(api.users.getMe);

  const [phase, setPhase]     = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  const drawFrame = useCallback(() => {
    if (!activeRef.current) return;
    const video  = videoRef.current;
    const canvas = previewCanvas.current;
    if (video && canvas && video.readyState >= 2) {
      const W = 640;
      const H = 640;
      const ctx = canvas.getContext('2d')!;

      const vW       = video.videoWidth  || 640;
      const vH       = video.videoHeight || 480;
      const cropSize = Math.min(vW, vH);
      const cropX    = (vW - cropSize) / 2;
      const cropY    = (vH - cropSize) / 2;

      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, cropX, cropY, cropSize, cropSize, 0, 0, W, H);
      ctx.restore();

      drawOverlay(ctx, W, H, false);
    }
    animFrameId.current = requestAnimationFrame(drawFrame);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 1280, height: 960 },
        audio: false,
      });
      const video = videoRef.current!;
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      await video.play();

      // Supersample canvas for crisp oval + vignette on hi-DPR screens
      const canvas = previewCanvas.current;
      if (canvas) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width  = 640 * dpr;
        canvas.height = 640 * dpr;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.scale(dpr, dpr);
      }

      activeRef.current = true;
      setPhase('ready');
      animFrameId.current = requestAnimationFrame(drawFrame);
    } catch {
      setPhase('error');
      setErrorMsg('Camera access denied.');
    }
  }, [drawFrame]);

  useEffect(() => {
    const video = videoRef.current;
    void startCamera();
    return () => {
      activeRef.current = false;
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
      const stream = video?.srcObject as MediaStream | null;
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [startCamera]);

  async function finishWithDataUrl(imageDataUrl: string) {
    setPhase('captured');
    onDataUrlReady?.(imageDataUrl);

    const W = 640;
    const H = 640;

    const profile: UserHeadProfile = {
      headProportions: { width: 1.6, height: 2.0, crownY: 1.0 },
      anchors: {
        earLeft:  [-0.85, 0, 0],
        earRight: [ 0.85, 0, 0],
      },
      hairMeasurements: {
        crownHeight: 0.3,
        sideWidth:   0.2,
        backLength:  0.25,
        flatness:    0.5,
        hairline:    0.28,
        hairThickness: 0.16,
      },
      faceScanData: {
        landmarks:   [],
        imageDataUrl,
        imageWidth:  W,
        imageHeight: H,
      },
      currentStyle: {
        preset:    'default',
        hairType,
        colorRGB:  '#3b1f0a',
        params:    { topLength: 1, sideLength: 1, backLength: 1, messiness: 0, taper: 0.5, pc1: 0, pc2: 0, pc3: 0, pc4: 0, pc5: 0, pc6: 0 },
      },
    };

    let sessionId: string | null = null;
    let uploadedImageUrl: string | null = null;
    try {
      const res = await fetch('/api/save-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageDataUrl,
          currentProfile: buildCurrentProfilePayload(profile),
        }),
      });
      const data = await res.json();
      sessionId = data.sessionId ?? null;
      uploadedImageUrl = data.downloadUrl ?? null;
    } catch {
      // Non-fatal
    }

    onScanComplete(profile, sessionId, uploadedImageUrl ?? imageDataUrl);
  }

  async function capturePhoto() {
    if (!isSignedIn) {
      openSignIn();
      return;
    }
    if (!paywallDisabled && convexUser != null && convexUser.credits <= 0) {
      onNoTokens?.();
      return;
    }
    const video  = videoRef.current;
    const canvas = previewCanvas.current;
    if (!video || !canvas) return;

    activeRef.current = false;
    if (animFrameId.current) cancelAnimationFrame(animFrameId.current);

    const W = 640;
    const H = 640;
    const ctx = canvas.getContext('2d')!;

    const vW       = video.videoWidth  || 640;
    const vH       = video.videoHeight || 480;
    const cropSize = Math.min(vW, vH);
    const cropX    = (vW - cropSize) / 2;
    const cropY    = (vH - cropSize) / 2;

    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, cropX, cropY, cropSize, cropSize, 0, 0, W, H);
    ctx.restore();

    const imageDataUrl = canvas.toDataURL('image/png');

    drawOverlay(ctx, W, H, true);

    const stream = video.srcObject as MediaStream | null;
    stream?.getTracks().forEach(t => t.stop());

    await finishWithDataUrl(imageDataUrl);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    activeRef.current = false;
    if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach(t => t.stop());

    try {
      const bitmap = await createImageBitmap(file);
      const W = 640, H = 640;
      const offscreen = document.createElement('canvas');
      offscreen.width = W;
      offscreen.height = H;
      const ctx = offscreen.getContext('2d')!;
      const size = Math.min(bitmap.width, bitmap.height);
      const sx = (bitmap.width - size) / 2;
      const sy = (bitmap.height - size) / 2;
      ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, W, H);
      bitmap.close();
      await finishWithDataUrl(offscreen.toDataURL('image/png'));
    } catch (err) {
      setPhase('error');
      setErrorMsg('Could not load image. Please try a JPEG or PNG file.');
      console.error('[ScanCamera] upload failed:', err);
    }
  }

  const instruction =
    phase === 'loading'  ? 'Preparing the chair…' :
    phase === 'ready'    ? 'Settle in. Place your face inside the oval.' :
    phase === 'captured' ? 'Photograph taken, sir.' :
    errorMsg;

  return (
    <div className="relative flex flex-col items-center w-full">
      <video ref={videoRef} className="hidden" muted playsInline />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleUpload}
      />

      {/* Single wrapper spans camera + paper so tape corners anchor correctly */}
      <div style={{ position: 'relative', width: '100%' }}>

        {/* Camera — no rounded corners */}
        <div className="relative w-full bg-[#1c1510]" style={{ aspectRatio: '1/1', overflow: 'hidden' }}>
          <canvas
            ref={previewCanvas}
            width={640}
            height={640}
            className="w-full h-full object-cover"
          />

          {phase === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#1c1510]">
              <div className="flex flex-col items-center gap-3">
                <div className="scissor-loader" />
                <span className="font-sans text-[11px] uppercase tracking-wider text-[var(--butter)]">
                  Adjusting the mirror
                </span>
              </div>
            </div>
          )}

          {phase === 'captured' && (
            <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(28, 21, 16, 0.78)' }}>
              <div className="anim-fade-up text-center">
                <div className="font-sans text-[11px] uppercase tracking-wider text-[var(--butter)]">Captured</div>
                <div className="font-display italic text-3xl text-[var(--cream)] mt-1" style={{ fontWeight: 500 }}>Splendid.</div>
              </div>
            </div>
          )}

          {phase === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#1c1510] p-6 text-center">
              <div>
                <div className="font-sans text-[11px] uppercase tracking-wider text-[var(--tomato)]">Error</div>
                <div className="font-display italic text-xl text-[var(--cream)] mt-1" style={{ fontWeight: 500 }}>{errorMsg}</div>
              </div>
            </div>
          )}
        </div>

        {/* Paper card — no rounded corners, extends 10px beyond camera on each side */}
        <div style={{
          background: 'var(--chalk)',
          borderRadius: 0,
          margin: '0 -10px',
          padding: '22px 34px 40px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
          boxShadow: '0 10px 28px -8px rgba(42,32,26,0.22)',
        }}>
          <p className="font-serif italic text-center text-[var(--char)] text-[17px] min-h-[1.5rem]">
            {instruction}
          </p>

          {phase === 'ready' && (
            <button
              onClick={capturePhoto}
              className="btn btn-tomato"
              style={{ padding: '12px 32px', fontSize: 18, fontFamily: 'var(--font-fraunces), Georgia, serif', fontVariationSettings: "'SOFT' 100, 'WONK' 0, 'opsz' 144", fontWeight: 900, letterSpacing: '-0.02em', textTransform: 'none' }}
            >
              Take Picture
            </button>
          )}

          {(phase === 'loading' || phase === 'ready') && (
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font-fraunces), Georgia, serif', fontVariationSettings: "'SOFT' 100, 'WONK' 0, 'opsz' 144", fontWeight: 700, fontSize: 13, color: 'var(--char)', letterSpacing: '-0.01em', opacity: 0.7, marginTop: 2 }}
            >
              Upload a photo
            </button>
          )}
        </div>

        {/* Tape rendered last — paints over camera and paper without z-index hacks */}
        <div className="tape tape-tl" />
        <div className="tape tape-tr" />
        <div className="tape tape-bl" />
        <div className="tape tape-br" />
      </div>
    </div>
  );
}
