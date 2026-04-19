'use client';

import { buildCurrentProfilePayload } from '@/lib/llmPayload';
import { useEffect, useRef, useState } from 'react';

import { UserHeadProfile } from '@/types';

interface ScanCameraProps {
  hairType: 'straight' | 'wavy' | 'curly';
  onScanComplete: (profile: UserHeadProfile, sessionId: string | null, imageUrl: string | null) => void;
  onDismiss: () => void;
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

export default function ScanCamera({ hairType, onScanComplete, onDismiss }: ScanCameraProps) {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const animFrameId   = useRef<number | null>(null);
  const activeRef     = useRef(false);

  const [phase, setPhase]     = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    startCamera();
    return () => {
      activeRef.current = false;
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  async function startCamera() {
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
  }

  function drawFrame() {
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
  }

  async function capturePhoto() {
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

    setPhase('captured');

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

    onScanComplete(profile, sessionId, uploadedImageUrl);
  }

  const instruction =
    phase === 'loading'  ? 'Preparing the chair…' :
    phase === 'ready'    ? 'Settle in. Place your face inside the oval.' :
    phase === 'captured' ? 'Photograph taken, sir.' :
    errorMsg;

  return (
    <div className="relative flex flex-col items-center w-full">
      <video ref={videoRef} className="hidden" muted playsInline />

      <div className="relative w-full bg-[#1c1510]" style={{ aspectRatio: '1/1' }}>
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

      <div className="w-full bg-[var(--cream)] border-t border-[var(--char)]/10 px-5 py-5 flex flex-col items-center gap-3">
        <p className="font-serif italic text-center text-[var(--char)] text-[15px] min-h-[1.5rem]">
          {instruction}
        </p>

        {phase === 'ready' && (
          <button
            onClick={capturePhoto}
            className="btn btn-tomato"
          >
            ✂ Take the seat
          </button>
        )}

        {(phase === 'loading' || phase === 'error' || phase === 'ready') && (
          <button
            onClick={onDismiss}
            className="font-sans text-[11px] text-[var(--smoke)] hover:text-[var(--tomato)] underline underline-offset-4 decoration-dotted"
          >
            Skip the chair
          </button>
        )}
      </div>
    </div>
  );
}
