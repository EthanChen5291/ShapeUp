'use client';

// ============================================================
// BarberVideoResult — the finished 360° splat clip.
// Autoplays + loops a muted preview; the "Show your barber" button (with a
// download icon) saves the file.
// ============================================================

import { useMemo, useState } from 'react';

interface BarberVideoResultProps {
  videoUrl: string;
  ext: string;
  projectName?: string;
}

// Strip characters that are illegal in filenames, keeping spaces and '#'.
function sanitizeName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || 'project';
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

export default function BarberVideoResult({ videoUrl, ext, projectName }: BarberVideoResultProps) {
  const [saved, setSaved] = useState(false);

  // shapeup-[project-name] #NNN — the random 3-digit tag is fixed per recording
  // (re-derived only when a fresh clip arrives) so the name is stable on save.
  const fileBase = useMemo(() => {
    const tag = Math.floor(100 + Math.random() * 900); // 100–999
    return `ShapeUp-${sanitizeName(projectName ?? 'project')} #${tag}`;
  }, [projectName, videoUrl]);

  const handleSave = () => {
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `${fileBase}.${ext}`;
    a.click();
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl overflow-hidden" style={{ background: '#1c1510', border: '1px solid rgba(42,32,26,0.14)' }}>
        <video
          src={videoUrl}
          autoPlay
          loop
          muted
          playsInline
          aria-label="360° preview of your cut"
          style={{ display: 'block', width: '100%', height: 'auto' }}
        />
      </div>

      <button
        onClick={handleSave}
        aria-label="Save your barber video"
        className="btn btn-tomato btn-snap flex items-center justify-center gap-2"
        style={{ padding: '10px 12px', fontSize: 12 }}
      >
        {saved ? 'Saved ✓' : 'Show your barber'}
        <DownloadIcon />
      </button>
    </div>
  );
}
