'use client';

// ============================================================
// SelfieCapture — the "take a selfie" step of the barber-card try-on.
//
// Two paths to one Blob: a live front-camera view with a shutter button, and
// a plain file picker. The camera is progressive enhancement — if getUserMedia
// is missing (jsdom, desktop without a camera, iOS in a weird webview) or the
// permission is denied, the component quietly collapses to upload-only with a
// one-line note instead of an error wall. The parent owns validation and
// everything after the photo exists.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';

export interface SelfieCaptureProps {
  /** A photo exists (camera frame or picked file) — parent takes over. */
  onPhoto: (blob: Blob) => void;
  disabled?: boolean;
}

type CameraState = 'starting' | 'live' | 'blocked';
type CameraIssue = 'permission' | 'missing' | 'insecure' | 'unknown';

function CameraIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.5h7l1 1.5H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 16V4m0 0 4 4m-4-4-4 4" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}

const SELFIE_REQUIREMENTS = [
  { label: 'Face centered', icon: '◎' },
  { label: 'Full hair visible', icon: '⌁' },
  { label: 'Even light', icon: '☼' },
] as const;

export default function SelfieCapture({ onPhoto, disabled = false }: SelfieCaptureProps) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState<CameraState>('starting');
  const [cameraIssue, setCameraIssue] = useState<CameraIssue | null>(null);

  // Start the front camera; land in 'unavailable' on any refusal. The stream
  // is torn down on unmount so the camera light never outlives the step.
  const startCamera = useCallback(async () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCamera('starting');
    setCameraIssue(null);
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!media?.getUserMedia) {
      setCameraIssue(typeof window !== 'undefined' && !window.isSecureContext ? 'insecure' : 'missing');
      setCamera('blocked');
      return;
    }
    try {
      // Keep the request broad. Some mobile browsers reject otherwise valid
      // cameras when square ideal dimensions and facingMode are combined.
      const stream = await media.getUserMedia({ video: { facingMode: { ideal: 'user' } }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      setCamera('live');
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      setCameraIssue(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'permission'
          : name === 'NotFoundError' || name === 'DevicesNotFoundError'
            ? 'missing'
            : 'unknown',
      );
      setCamera('blocked');
    }
  }, []);

  useEffect(() => {
    void startCamera();
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [startCamera]);

  const snap = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Un-mirror: the preview flips for a mirror feel, but the saved photo
    // should read the way other people (and the render model) see the face.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) onPhoto(blob);
    }, 'image/jpeg', 0.92);
  }, [onPhoto]);

  return (
    <div className="selfie-capture">
      {camera !== 'blocked' ? (
        <div className="selfie-stage">
          <video ref={videoRef} className="selfie-video" muted playsInline autoPlay />
          {camera === 'starting' ? <div className="selfie-starting font-sans">{t('Starting front camera…')}</div> : null}
          {/* Framing guide: keep the head inside the oval, hairline included. */}
          <div className="selfie-guide" aria-hidden>
            <span className="selfie-guide-oval" />
          </div>
          <p className="selfie-hint font-sans">{t('Keep your full head in frame')}</p>
          <div className="selfie-requirements" aria-label={t('Photo requirements')}>
            {SELFIE_REQUIREMENTS.map((item) => (
              <span className="selfie-requirement" key={item.label} title={t(item.label)}>
                <span aria-hidden>{item.icon}</span><span className="selfie-checkmark" aria-hidden>✓</span>
              </span>
            ))}
          </div>
          <button
            type="button"
            className="selfie-shutter"
            onClick={snap}
            disabled={disabled || camera !== 'live'}
            aria-label={t('Take the photo')}
          >
            <span className="selfie-shutter-ring" aria-hidden />
          </button>
        </div>
      ) : (
        <div className="selfie-camera-recovery">
          <span className="selfie-camera-recovery-icon"><CameraIcon /></span>
          <strong className="font-sans">
            {cameraIssue === 'permission' ? t('Camera permission is off') : cameraIssue === 'missing' ? t('No front camera found') : cameraIssue === 'insecure' ? t('Camera needs a secure connection') : t('The camera didn’t start')}
          </strong>
          <p className="font-sans">
            {cameraIssue === 'permission' ? t('Allow camera access in your browser settings, then try again.') : t('You can retry the camera or upload a clear front-facing photo.')}
          </p>
          <button type="button" className="selfie-retry" onClick={() => void startCamera()}>{t('Try camera again')}</button>
        </div>
      )}

      <button
        type="button"
        className="selfie-upload"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled}
      >
        <UploadIcon />
        <span className="font-sans">{t('Upload an image')}</span>
      </button>
      {camera !== 'blocked' ? (
        <button type="button" className="selfie-match" onClick={snap} disabled={disabled || camera !== 'live'}>
          {t('Match my best hairstyles')}
        </button>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPhoto(file);
          e.target.value = ''; // same file re-pickable after a retake
        }}
      />
    </div>
  );
}
