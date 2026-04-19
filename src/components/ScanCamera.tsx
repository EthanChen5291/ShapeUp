'use client';

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

  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = captured ? '#22c55e' : '#ffffff';
  ctx.lineWidth = 3;
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
        video: { facingMode: 'user', width: 640, height: 480 },
        audio: false,
      });
      const video = videoRef.current!;
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      await video.play();
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
      const W = canvas.width;
      const H = canvas.height;
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

    const W = canvas.width;
    const H = canvas.height;
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

    // Upload to Firebase and get session info before completing
    let sessionId: string | null = null;
    let uploadedImageUrl: string | null = null;
    try {
      const res = await fetch('/api/save-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl }),
      });
      const data = await res.json();
      sessionId = data.sessionId ?? null;
      uploadedImageUrl = data.downloadUrl ?? null;
    } catch {
      // Non-fatal — proceed without session
    }

    onScanComplete(profile, sessionId, uploadedImageUrl);
  }

  const instruction =
    phase === 'loading'  ? 'Preparing camera…' :
    phase === 'ready'    ? 'Place your face in the oval, then take a photo' :
    phase === 'captured' ? 'Photo saved!' :
    errorMsg;

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <video ref={videoRef} className="hidden" muted playsInline />

      <div className="relative w-full rounded-2xl overflow-hidden bg-gray-800" style={{ aspectRatio: '1/1' }}>
        <canvas
          ref={previewCanvas}
          width={640}
          height={640}
          className="w-full h-full object-cover"
        />
        {phase === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
            Loading camera…
          </div>
        )}
        {phase === 'captured' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
            <span className="text-green-400 text-xl font-semibold">Done</span>
          </div>
        )}
      </div>

      <p className="text-sm text-white text-center min-h-[1.5rem]">{instruction}</p>

      {phase === 'ready' && (
        <button
          onClick={capturePhoto}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-full text-sm font-medium"
        >
          Take Photo
        </button>
      )}

      {(phase === 'loading' || phase === 'error' || phase === 'ready') && (
        <button onClick={onDismiss} className="text-xs text-gray-500 underline mt-1">
          Skip camera scan
        </button>
      )}
    </div>
  );
}
