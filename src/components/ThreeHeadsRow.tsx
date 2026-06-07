'use client';

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Splat } from '@react-three/drei';
import * as THREE from 'three';

const SRCS = ['/edit-output.splat', '/original-output.splat', '/edit-output.splat'];

function SplatHead({ src }: { src: string }) {
  return (
    <Suspense fallback={null}>
      <Splat
        src={src}
        alphaTest={0.02}
        scale={2.772}
        position={[0, -0.07, 0.48]}
        rotation={[-Math.PI / 2, Math.PI, Math.PI]}
      />
    </Suspense>
  );
}

export default function ThreeHeadsRow() {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex' }}>
      {SRCS.map((src, i) => (
        <div key={i} style={{ flex: 1, height: '100%' }}>
          <Canvas
            gl={{ toneMapping: THREE.NoToneMapping }}
            camera={{ position: [0, 0, 7.8], fov: 45 }}
            style={{ width: '100%', height: '100%', display: 'block', background: '#f6ecd8' }}
          >
            <SplatHead src={src} />
          </Canvas>
        </div>
      ))}
    </div>
  );
}
