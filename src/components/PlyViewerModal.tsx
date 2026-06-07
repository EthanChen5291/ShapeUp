'use client';

import { OrbitControls, Splat } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';

interface Props {
  src: string;
  onClose: () => void;
}

export default function PlyViewerModal({ src, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#fff' }}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-neutral-100 border-b border-neutral-300 shrink-0">
        <span className="font-mono text-xs text-neutral-500 truncate flex-1">{src.split('?')[0]}</span>
        <span className="text-xs text-neutral-400">drag to orbit · scroll to zoom</span>
        <button
          onClick={onClose}
          className="px-3 py-1 rounded bg-neutral-200 hover:bg-neutral-300 text-sm font-mono text-neutral-700 transition-colors"
        >
          close
        </button>
      </div>

      {/* 3D canvas */}
      <div className="flex-1">
        <Canvas
          camera={{ position: [0, 0, 5], fov: 60 }}
          style={{ width: '100%', height: '100%', background: '#ffffff' }}
        >
          <Suspense fallback={null}>
            <Splat
              src={src}
              alphaTest={0.02}
              rotation={[-Math.PI / 2, Math.PI, Math.PI]}
            />
          </Suspense>
          <OrbitControls />
        </Canvas>
      </div>
    </div>
  );
}
