'use client';

import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { View, PerspectiveCamera, Splat } from '@react-three/drei';
import { Suspense, useEffect, useRef, useState } from 'react';
import {
  primaryVariant,
  HAIR_COLOR_SWATCH,
  type HairCut,
  type HairColor,
  type PresetVariant,
} from '@/data/hairPresets';

interface PresetStyleRailProps {
  cuts: HairCut[];
  userColor: HairColor;
  /** Paid plan (or allowlisted) — unlocks every color. */
  isPaid: boolean;
  visible: boolean;
  selectedSplatUrl: string | null;
  /** Hover a look to preview it on the head in the big scene (null on leave). */
  onHover: (splatUrl: string | null) => void;
  /** Commit an unlocked look. */
  onSelect: (splatUrl: string) => void;
  /** A free user tapped a locked color — nudge them to upgrade. */
  onLocked: () => void;
}

// Mirror the main scene's splat framing so the hair reads right in the circles.
const PREVIEW_SPLAT = {
  scale: 2.772,
  position: [0, -0.07, 0.48] as [number, number, number],
  rotation: [-Math.PI / 2, Math.PI, Math.PI] as [number, number, number],
};

const ORB = 74;
const ORB_SM = 56;

function LockBadge() {
  return (
    <span className="preset-orb-lock" aria-hidden>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4.5" y="11" width="15" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
    </span>
  );
}

// The visual circle: live-renders the look's splat into the shared canvas. The
// 3D layer only mounts when `active` (so collapsed color columns don't eat
// bandwidth downloading every variant's multi-MB splat up front).
function OrbVisual({ variant, size, locked, selected, active }: { variant: PresetVariant; size: number; locked: boolean; selected: boolean; active: boolean }) {
  return (
    <span className={`preset-orb ${selected ? 'preset-orb-selected' : ''} ${locked ? 'preset-orb-locked' : ''}`} style={{ width: size, height: size }}>
      {active && (
        <View className="preset-orb-view" style={{ width: size, height: size }}>
          <PerspectiveCamera makeDefault position={[0, 0, 7.8]} fov={45} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 10, 5]} intensity={1.0} />
          <directionalLight position={[0, 2, 5]} intensity={0.8} />
          <Suspense fallback={null}>
            <Splat src={variant.splatUrl} alphaTest={0.02} scale={PREVIEW_SPLAT.scale} position={PREVIEW_SPLAT.position} rotation={PREVIEW_SPLAT.rotation} />
          </Suspense>
        </View>
      )}
      <span className="preset-orb-sheen" aria-hidden />
      {locked && <LockBadge />}
    </span>
  );
}

function CutColumn({
  cut,
  index,
  userColor,
  isPaid,
  shown,
  expanded,
  selectedSplatUrl,
  onExpand,
  onHover,
  onSelect,
  onLocked,
}: {
  cut: HairCut;
  index: number;
  userColor: HairColor;
  isPaid: boolean;
  shown: boolean;
  expanded: boolean;
  selectedSplatUrl: string | null;
  onExpand: () => void;
  onHover: (url: string | null) => void;
  onSelect: (url: string) => void;
  onLocked: () => void;
}) {
  const primary = primaryVariant(cut, userColor);
  const primaryUnlocked = isPaid || primary.color === userColor;
  // The "other colors" that drop down when the cut is opened.
  const others = cut.variants.filter((v) => v.id !== primary.id);

  const pick = (v: PresetVariant) => {
    const unlocked = isPaid || v.color === userColor;
    if (unlocked) onSelect(v.splatUrl);
    else onLocked();
  };

  return (
    <div
      className="preset-cut-col"
      style={{
        opacity: shown ? 1 : 0,
        transform: `translateX(${shown ? 0 : 34}px)`,
        transition: `transform 0.5s cubic-bezier(0.22,1,0.36,1) ${index * 0.06}s, opacity 0.5s cubic-bezier(0.22,1,0.36,1) ${index * 0.06}s`,
      }}
    >
      <button
        type="button"
        className="preset-orb-btn"
        title={cut.name}
        onMouseEnter={() => onHover(primary.splatUrl)}
        onMouseLeave={() => onHover(null)}
        onClick={() => { onExpand(); pick(primary); }}
      >
        <OrbVisual variant={primary} size={ORB} locked={!primaryUnlocked} selected={selectedSplatUrl === primary.splatUrl} active />
        <span className="preset-orb-label">{cut.name}</span>
      </button>

      {/* Other colors lerp down as locked/unlocked options. */}
      {others.length > 0 && (
        <div className={`preset-variant-col ${expanded ? 'preset-variant-col-open' : ''}`} aria-hidden={!expanded}>
          {others.map((v, vi) => {
            const unlocked = isPaid || v.color === userColor;
            return (
              <button
                key={v.id}
                type="button"
                className="preset-orb-btn preset-orb-btn-sm"
                title={`${cut.name} · ${v.label}${unlocked ? '' : ' (paid plan)'}`}
                style={{
                  transform: expanded ? 'translateY(0)' : 'translateY(-12px)',
                  opacity: expanded ? 1 : 0,
                  transition: `transform 0.4s cubic-bezier(0.22,1,0.36,1) ${vi * 0.05}s, opacity 0.4s cubic-bezier(0.22,1,0.36,1) ${vi * 0.05}s`,
                  pointerEvents: expanded ? 'auto' : 'none',
                }}
                onMouseEnter={() => onHover(v.splatUrl)}
                onMouseLeave={() => onHover(null)}
                onClick={() => pick(v)}
              >
                <OrbVisual variant={v} size={ORB_SM} locked={!unlocked} selected={selectedSplatUrl === v.splatUrl} active={expanded} />
                <span className="preset-orb-swatch-row">
                  <span className="preset-orb-swatch" style={{ background: HAIR_COLOR_SWATCH[v.color] }} />
                  <span className="preset-orb-sublabel">{v.label}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function PresetStyleRail({ cuts, userColor, isPaid, visible, selectedSplatUrl, onHover, onSelect, onLocked }: PresetStyleRailProps) {
  // Keep the WebGL layer mounted only while on screen (+ fade-out) so the shared
  // context is released when the rail closes. Same trick as HairRecommendationsBar.
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [expandedCutId, setExpandedCutId] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    if (visible) {
      setMounted(true);
      showTimer = setTimeout(() => setShown(true), 20);
    } else {
      setShown(false);
      setExpandedCutId(null);
      hideTimer = setTimeout(() => setMounted(false), 500);
    }
    return () => { if (hideTimer) clearTimeout(hideTimer); if (showTimer) clearTimeout(showTimer); };
  }, [visible]);

  // Replay the lerp-in (and collapse) whenever the cut set changes (category swap).
  useEffect(() => {
    if (!visible) return;
    setShown(false);
    setExpandedCutId(null);
    const t = setTimeout(() => setShown(true), 20);
    return () => clearTimeout(t);
  }, [cuts, visible]);

  return (
    <>
      <div
        ref={railRef}
        className="preset-rail"
        style={{
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? 'auto' : 'none',
          transition: 'opacity 0.4s cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        {mounted && cuts.map((cut, i) => (
          <CutColumn
            key={cut.id}
            cut={cut}
            index={i}
            userColor={userColor}
            isPaid={isPaid}
            shown={shown}
            expanded={expandedCutId === cut.id}
            selectedSplatUrl={selectedSplatUrl}
            onExpand={() => setExpandedCutId((cur) => (cur === cut.id ? cur : cut.id))}
            onHover={onHover}
            onSelect={onSelect}
            onLocked={onLocked}
          />
        ))}
      </div>

      {/* One shared WebGL context paints every <View> rect. Sibling of the rail
          (not a child) so the rail's transforms don't trap this fixed canvas. */}
      {mounted && (
        <Canvas
          style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 41 }}
          gl={{ antialias: true, alpha: true, toneMapping: THREE.NoToneMapping }}
        >
          <View.Port />
        </Canvas>
      )}
    </>
  );
}
