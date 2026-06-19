'use client';

import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { Suspense, useEffect, useRef, useState } from 'react';
import HairStrandMesh from './HairStrandMesh';

const RECOMMENDATIONS = [
  { label: 'Style 1', url: '/prebake_0.splat' },
  { label: 'Style 2', url: '/prebake_1.splat' },
];

interface HairRecommendationsBarProps {
  onHover: (url: string | null) => void;
  onSelect: (url: string) => void;
  visible: boolean;
}

export default function HairRecommendationsBar({ onHover, onSelect, visible }: HairRecommendationsBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [everShown, setEverShown] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (visible) {
      setEverShown(true);
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
      el.style.pointerEvents = 'auto';
    } else {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-18px)';
      el.style.pointerEvents = 'none';
    }
  }, [visible]);

  return (
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
        {everShown && RECOMMENDATIONS.map((rec) => (
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
            <div style={{ width: 56, height: 68 }}>
              <Canvas
                gl={{ toneMapping: THREE.NoToneMapping, antialias: true }}
                camera={{ position: [0, 0, 7.8], fov: 45 }}
                style={{ width: '100%', height: '100%', background: '#17110d' }}
              >
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
              </Canvas>
            </div>
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
  );
}
