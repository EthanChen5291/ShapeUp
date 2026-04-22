'use client';

import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { Suspense, useEffect, useRef } from 'react';
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

export default function HairRecommendationsBar({ onHover, onSelect, visible }: HairRecommendationsBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (visible) {
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
        {RECOMMENDATIONS.map((rec) => (
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
