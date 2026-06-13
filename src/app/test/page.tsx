'use client';

import { Center, OrbitControls } from '@react-three/drei';
import React, { Suspense } from 'react';

import { Canvas } from '@react-three/fiber';
import { HairModel } from '../../components/HairModel';
import { useRef } from 'react';

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#111' }}>
      <Canvas camera={{ position: [0, 0, 5], fov: 45 }}>
        {/* Lights are mandatory for MeshStandardMaterial to be visible */}
        <ambientLight intensity={1.5} />
        <directionalLight position={[5, 5, 5]} intensity={2} castShadow />
        <pointLight position={[-5, 5, -5]} intensity={1} />

        <Suspense fallback={null}>
          <Center>
            <HairModel
              plyUrl="/inference_results/bob_cut/upsampled_hairstyle/pc_1.ply"       // Must be placed in your /public folder
              // textureUrl="/textures/hair.png" // Must be placed in your /public folder
              color="#3a2312"
            />
          </Center>
        </Suspense>

        <OrbitControls enableDamping lookAt={[0, 0, 0]} />
      </Canvas>
    </div>
  );
}
