'use client';

import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { View, PerspectiveCamera } from '@react-three/drei';
import { Suspense, useEffect, useRef, useState } from 'react';
import HairStrandMesh from './HairStrandMesh';

const RECOMMENDATIONS = [
  {
    label: 'Bruno',
    url: `/api/proxy-ply?url=${encodeURIComponent('https://firebasestorage.googleapis.com/v0/b/hackprinceton-shapeup.firebasestorage.app/o/scans%2FGuICOu5AppsxsKSVbiH8%2Fhairstep.ply?alt=media&token=0699eba2-0572-489f-9eb2-e95b0ffc7b6f')}`,
  },
  {
    label: 'Coco',
    url: `/api/proxy-ply?url=${encodeURIComponent('https://firebasestorage.googleapis.com/v0/b/hackprinceton-shapeup.firebasestorage.app/o/scans%2FUJvCn1dm3z7VgrgR38FK%2Fhairstep.ply?alt=media&token=d4bbc7eb-d14c-45e5-af8f-7370468b2a2f')}`,
  },
  {
    label: 'Bruno Buzz',
    url: `/api/proxy-ply?url=${encodeURIComponent('https://firebasestorage.googleapis.com/v0/b/hackprinceton-shapeup.firebasestorage.app/o/scans%2FC5YRFTnE3BD7VoIT42O8%2Fhairstep.ply?alt=media&token=4204d17c-cd35-494d-80ca-55e6455004ff')}`,
  },
  {
    label: 'Style 4',
    url: `/api/proxy-ply?url=${encodeURIComponent('https://firebasestorage.googleapis.com/v0/b/hackprinceton-shapeup.firebasestorage.app/o/scans%2FER7aDgSO3lanUW60XG9Z%2Fhairstep.ply?alt=media&token=45ca7701-dc3d-4186-a8dc-6ec252ddd776')}`,
  },
  {
    label: 'Style 5',
    url: `/api/proxy-ply?url=${encodeURIComponent('https://firebasestorage.googleapis.com/v0/b/hackprinceton-shapeup.firebasestorage.app/o/scans%2F0sS08kIg86OwZFOR7EkD%2Fhairstep.ply?alt=media&token=923834f5-7df7-43e3-a591-91970be2679c')}`,
  },
];

interface HairRecommendationsBarProps {
  onHover: (url: string | null) => void;
  onSelect: (url: string) => void;
  visible: boolean;
}

// Each thumbnail used to mount its own <Canvas> (== its own WebGL context). With
// ~5 recommendations + the main scene that pushed the browser past its live-context
// ceiling and triggered "WebGLRenderer: Context Lost". drei's <View> renders every
// thumbnail into ONE shared context (one <Canvas> + <View.Port/>), each <View> DOM
// box teleporting its scene to the matching screen rect.
export default function HairRecommendationsBar({ onHover, onSelect, visible }: HairRecommendationsBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Mount the 3D layer only while the bar is on screen (+ the fade-out) so the
  // single shared context is released when the panel is closed.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    if (visible) {
      setMounted(true);
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
      el.style.pointerEvents = 'auto';
    } else {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-18px)';
      el.style.pointerEvents = 'none';
      hideTimer = setTimeout(() => setMounted(false), 500);
    }
    return () => { if (hideTimer) clearTimeout(hideTimer); };
  }, [visible]);

  return (
    <>
      <div
        ref={containerRef}
        style={{
          opacity: 0,
          transform: 'translateY(-18px)',
          transition: 'opacity 0.45s cubic-bezier(0.22,1,0.36,1), transform 0.45s cubic-bezier(0.22,1,0.36,1)',
          pointerEvents: 'none',
        }}
      >
        <div
          className="font-mono text-[9px] uppercase tracking-[0.2em] text-center mb-1"
          style={{ color: 'rgba(255,248,234,0.6)' }}
        >
          styles
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
          {mounted && RECOMMENDATIONS.map((rec) => (
            <div
              key={rec.url}
              onMouseEnter={() => onHover(rec.url)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onSelect(rec.url)}
              style={{
                width: 56,
                cursor: 'pointer',
                borderRadius: 6,
                overflow: 'hidden',
                border: '1px solid rgba(255,248,234,0.15)',
                background: 'rgba(0,0,0,0.35)',
                transition: 'border-color 0.15s, transform 0.15s',
              }}
              onMouseOver={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,248,234,0.5)';
                (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.04)';
              }}
              onMouseOut={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,248,234,0.15)';
                (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)';
              }}
            >
              {/* <View> is the DOM box; its 3D children are rendered by <View.Port/>
                  into the shared canvas at this element's screen rect. */}
              <View style={{ width: 56, height: 68, background: '#17110d' }}>
                <PerspectiveCamera makeDefault position={[0, 0, 7.8]} fov={45} />
                <ambientLight intensity={0.5} />
                <directionalLight position={[5, 10, 5]} intensity={1.0} />
                <directionalLight position={[0, 2, 5]} intensity={0.8} />
                <Suspense fallback={null}>
                  <HairStrandMesh
                    url={rec.url}
                    color="#3b1f0a"
                    scale={13.109}
                    position={[0, -23.149, 0.7]}
                    lineWidth={0.8}
                    renderOrder={0}
                  />
                </Suspense>
              </View>
              <div
                className="text-center font-mono"
                style={{
                  fontSize: 8,
                  padding: '2px 3px',
                  color: 'rgba(255,248,234,0.75)',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  borderTop: '1px solid rgba(255,248,234,0.08)',
                }}
              >
                {rec.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Single shared WebGL context for every thumbnail. Kept a sibling of the
          animated container above: that container's `transform` would otherwise
          become the containing block for this fixed canvas and break alignment.
          pointerEvents:none + transparent — it only paints the <View> rects, so
          the underlying DOM (hover/click on the boxes) is untouched. */}
      {mounted && (
        <Canvas
          style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 40 }}
          gl={{ antialias: true, alpha: true, toneMapping: THREE.NoToneMapping }}
        >
          <View.Port />
        </Canvas>
      )}
    </>
  );
}
