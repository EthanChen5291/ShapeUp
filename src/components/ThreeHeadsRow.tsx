'use client';

import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

function Head({ skinColor, hairColor, speed }: { skinColor: string; hairColor: string; speed: number }) {
  const ref = useRef<THREE.Group>(null!);
  useFrame((_, d) => { if (ref.current) ref.current.rotation.y += d * speed; });
  return (
    <group ref={ref}>
      <mesh position={[0, -0.9, 0]}>
        <cylinderGeometry args={[0.25, 0.3, 0.5, 20]} />
        <meshStandardMaterial color={skinColor} roughness={0.8} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.7, 32, 32]} />
        <meshStandardMaterial color={skinColor} roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.18, -0.03]} rotation={[0.1, 0, 0]}>
        <sphereGeometry args={[0.72, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        <meshStandardMaterial color={hairColor} roughness={0.9} side={THREE.FrontSide} />
      </mesh>
    </group>
  );
}

const HEADS = [
  { skinColor: '#e8c49a', hairColor: '#1a0a00', speed: 0.32 },
  { skinColor: '#c68642', hairColor: '#2c1810', speed: 0.25 },
  { skinColor: '#f5d5b8', hairColor: '#8b4513', speed: 0.40 },
];

export default function ThreeHeadsRow() {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex' }}>
      {HEADS.map((h, i) => (
        <div key={i} style={{ flex: 1, height: '100%' }}>
          <Canvas
            camera={{ position: [0, 0, 3], fov: 38 }}
            style={{ width: '100%', height: '100%', display: 'block', background: '#f6ecd8' }}
          >
            <ambientLight intensity={0.7} />
            <directionalLight position={[5, 8, 5]} intensity={1.2} />
            <directionalLight position={[-4, 2, 3]} intensity={0.4} />
            <Head {...h} />
          </Canvas>
        </div>
      ))}
    </div>
  );
}
