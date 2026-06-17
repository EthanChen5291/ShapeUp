'use client';

// ============================================================
// BarberVideoResult — the finished 360° splat clip.
// Autoplays + loops a muted preview; the "Show your barber" button (with a
// download icon) saves the file.
//
// On first success the clip pops out of its panel slot and smoothly lerps to a
// large, centered (~55% of viewport) overlay. A toggle button on the video
// switches between fullscreen-expand and exit-fullscreen icons; collapsing
// lerps it right back into its corner slot in the panel.
// ============================================================

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

interface BarberVideoResultProps {
  videoUrl: string;
  ext: string;
  projectName?: string;
}

interface Rect { top: number; left: number; width: number; height: number; }

// Smooth lerp easing for the pop-out / collapse glide.
const GLIDE = 'top 560ms cubic-bezier(0.22,1,0.3,1), left 560ms cubic-bezier(0.22,1,0.3,1), width 560ms cubic-bezier(0.22,1,0.3,1), height 560ms cubic-bezier(0.22,1,0.3,1)';

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

// Four arrows pointing outward — "go fullscreen / expand".
function ExpandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 3H3v5" />
      <path d="M21 8V3h-5" />
      <path d="M16 21h5v-5" />
      <path d="M3 16v5h5" />
    </svg>
  );
}

// Four arrows pointing inward — "exit fullscreen / shrink".
function CollapseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8h5V3" />
      <path d="M16 3v5h5" />
      <path d="M21 16h-5v5" />
      <path d="M8 21v-5H3" />
    </svg>
  );
}

// Size of the centered overlay given the clip's aspect ratio (~55% of the
// viewport's long edge, clamped so it never overflows).
function computeCenterRect(aspect: number): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let width = Math.min(vw * 0.56, 920);
  let height = width / aspect;
  const maxH = vh * 0.82;
  if (height > maxH) { height = maxH; width = height * aspect; }
  return { top: (vh - height) / 2, left: (vw - width) / 2, width, height };
}

export default function BarberVideoResult({ videoUrl, ext, projectName }: BarberVideoResultProps) {
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [aspect, setAspect] = useState(16 / 9);
  const [collapsedRect, setCollapsedRect] = useState<Rect | null>(null);
  const [tick, setTick] = useState(0); // forces center-rect recompute on resize
  const [gliding, setGliding] = useState(false); // transition only during toggles, not scroll-tracking

  const slotRef = useRef<HTMLDivElement>(null);
  const autoOpened = useRef(false);

  // Keep the collapsed (in-panel slot) rect in sync with layout so the video
  // stays pinned to its corner while resting, and the collapse lerp lands true.
  const measure = useCallback(() => {
    const el = slotRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCollapsedRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, []);

  // Glide only while a toggle is in flight; otherwise the scroll-tracking rect
  // updates would smear the pinned video behind the scroll.
  const setExpandedGliding = useCallback((next: boolean | ((v: boolean) => boolean)) => {
    setGliding(true);
    setExpanded(next);
    window.setTimeout(() => setGliding(false), 600);
  }, []);

  useLayoutEffect(() => { measure(); }, [measure, aspect]);

  useEffect(() => {
    const onChange = () => { measure(); setTick((t) => t + 1); };
    window.addEventListener('resize', onChange);
    // Capture phase so we also catch the scrolling panel, not just window.
    window.addEventListener('scroll', onChange, true);
    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
    };
  }, [measure]);

  // First time the clip is ready, pop it out to center. Start from the slot
  // rect (already rendered this frame) and flip to expanded next frame so the
  // glide animates from the corner.
  useEffect(() => {
    if (autoOpened.current || !collapsedRect) return;
    autoOpened.current = true;
    const id = requestAnimationFrame(() => setExpandedGliding(true));
    return () => cancelAnimationFrame(id);
  }, [collapsedRect, setExpandedGliding]);

  // Lock body scroll while the overlay is open.
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [expanded]);

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

  const centerRect = useMemo<Rect | null>(() => {
    if (typeof window === 'undefined') return null;
    return computeCenterRect(aspect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect, tick]);

  const rect = expanded ? centerRect : collapsedRect;

  return (
    <div className="flex flex-col gap-3">
      {/* In-panel slot — reserves the layout space; the live video floats above
          it (pinned here when collapsed, centered when expanded). */}
      <div
        ref={slotRef}
        className="rounded-xl"
        style={{ width: '100%', aspectRatio: String(aspect), background: '#1c1510', border: '1px solid rgba(42,32,26,0.14)' }}
      />

      {/* Dim backdrop behind the expanded overlay. */}
      {expanded && (
        <div
          onClick={() => setExpandedGliding(false)}
          aria-hidden
          style={{
            position: 'fixed', inset: 0, zIndex: 60,
            background: 'rgba(20,14,10,0.62)', backdropFilter: 'blur(3px)',
            animation: 'fadeIn 240ms ease',
          }}
        />
      )}

      {/* The floating clip itself. */}
      {rect && (
        <div
          className="rounded-xl overflow-hidden"
          style={{
            position: 'fixed',
            top: rect.top, left: rect.left, width: rect.width, height: rect.height,
            zIndex: expanded ? 70 : 20,
            background: '#1c1510',
            border: '1px solid rgba(42,32,26,0.14)',
            boxShadow: expanded ? '0 40px 90px -30px rgba(0,0,0,0.7)' : '0 30px 60px -24px rgba(0,0,0,0.45)',
            transition: gliding ? GLIDE : 'none',
          }}
        >
          <video
            src={videoUrl}
            autoPlay
            loop
            muted
            playsInline
            aria-label="360° preview of your cut"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
            }}
            style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
          />

          {/* Expand / collapse toggle, top-right of the clip. */}
          <button
            type="button"
            onClick={() => setExpandedGliding((v) => !v)}
            aria-label={expanded ? 'Shrink the video back to the panel' : 'Expand the video'}
            title={expanded ? 'Exit fullscreen' : 'Expand'}
            style={{
              position: 'absolute', top: 10, right: 10,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 34, height: 34, borderRadius: 10,
              color: 'rgba(245,241,234,0.96)',
              background: 'rgba(20,14,10,0.5)',
              border: '1px solid rgba(245,241,234,0.22)',
              backdropFilter: 'blur(6px)',
              cursor: 'pointer',
              transition: 'transform 200ms cubic-bezier(0.16,1,0.3,1), background 160ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.background = 'rgba(20,14,10,0.72)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = 'rgba(20,14,10,0.5)'; }}
          >
            {expanded ? <CollapseIcon /> : <ExpandIcon />}
          </button>
        </div>
      )}

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
