'use client';

import { OrbitControls, Splat } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, useState } from 'react';

const TAG = '[HairSplatViewer]';

interface Props {
  src: string;
  height?: number;
}

function SplatScene({ src }: { src: string }) {
  console.log(`${TAG} SplatScene: loading src="${src.substring(0, 80)}..."`);
  return (
    <>
      <Suspense fallback={null}>
        <Splat src={src} />
      </Suspense>
      <OrbitControls autoRotate autoRotateSpeed={0.8} />
    </>
  );
}

export default function HairSplatViewer({ src, height = 400 }: Props) {
  const [loadError, setLoadError] = useState<string | null>(null);

  console.log(`${TAG} render: src="${src.substring(0, 80)}...", loadError=${loadError}`);

  if (loadError) {
    return (
      <div style={{ width: '100%', height: 400, background: '#0a0805', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#d63c2f', fontFamily: 'monospace', fontSize: 13 }}>
          Splat load error: {loadError}
        </p>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height, borderRadius: 0, overflow: 'hidden' }}>
      <Canvas
        camera={{ position: [0, 0, 4], fov: 60 }}
        style={{ background: '#0a0805' }}
        onCreated={({ gl }) => {
          console.log(`${TAG} Canvas: WebGL context created, renderer=${gl.constructor.name}`);
        }}
      >
        <SplatScene src={src} />
      </Canvas>
      <div style={{
        textAlign: 'center',
        fontSize: 11,
        fontFamily: 'monospace',
        color: '#665',
        paddingTop: 6,
        background: '#0a0805',
        paddingBottom: 6,
      }}>
        drag to orbit · scroll to zoom
      </div>
    </div>
  );
}
