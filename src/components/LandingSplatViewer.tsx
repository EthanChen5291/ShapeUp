'use client';

import * as THREE from 'three';
import { OrbitControls, Splat } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useRef, useState } from 'react';

const HAIRSTYLES = [
  { key: '1', src: '/edit-output.splat' },
  { key: '2', src: '/original-output.splat' },
];

function Scene({ splatSrc }: { splatSrc: string }) {
  const orbitRef = useRef<any>(null);
  const rotH = useRef(0);
  const rotV = useRef(0);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  { rotH.current = -1; e.preventDefault(); }
      if (e.key === 'ArrowRight') { rotH.current =  1; e.preventDefault(); }
      if (e.key === 'ArrowUp')    { rotV.current = -1; e.preventDefault(); }
      if (e.key === 'ArrowDown')  { rotV.current =  1; e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowRight') rotH.current = 0;
      if (e.key === 'ArrowUp'    || e.key === 'ArrowDown')  rotV.current = 0;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useFrame((_, delta) => {
    if (!orbitRef.current || (rotH.current === 0 && rotV.current === 0)) return;
    const ctrl = orbitRef.current;
    const offset = new THREE.Vector3().subVectors(ctrl.object.position, ctrl.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    if (rotH.current !== 0) sph.theta += rotH.current * delta * 0.75;
    if (rotV.current !== 0) {
      sph.phi = Math.max(0.1, Math.min(Math.PI - 0.1, sph.phi + rotV.current * delta * 0.75));
    }
    sph.makeSafe();
    offset.setFromSpherical(sph);
    ctrl.object.position.copy(ctrl.target).add(offset);
    ctrl.update();
  });

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]} intensity={1.0} castShadow />
      <directionalLight position={[0, 2, 5]}  intensity={0.8} />

      <Suspense key={splatSrc} fallback={null}>
        <Splat src={splatSrc} alphaTest={0.02} scale={2.772} position={[0, -0.07, 0.48]} rotation={[-Math.PI / 2, Math.PI, Math.PI]} />
        <Splat src={splatSrc} alphaTest={0.02} scale={2.772} position={[0, -0.07, 0.48]} rotation={[-Math.PI / 2, Math.PI, Math.PI]} />
      </Suspense>

      <OrbitControls
        ref={orbitRef}
        enablePan={false}
        minPolarAngle={0}
        maxPolarAngle={Math.PI / 2 + (10 * Math.PI / 180)}
        minDistance={2.5}
        maxDistance={7.8}
      />
    </>
  );
}

export default function LandingSplatViewer() {
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = parseInt(e.key);
      if (n >= 1 && n <= HAIRSTYLES.length) setActiveIdx(n - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div style={{
      position: 'relative', width: '100%', height: '100%',
      backgroundImage: 'url(/blobbg.png)', backgroundSize: '130%', backgroundPosition: 'center',
    }}>
      <Canvas
        gl={{ toneMapping: THREE.NoToneMapping, alpha: true }}
        camera={{ position: [0, 0, 7.8], fov: 45 }}
        style={{ width: '100%', height: '100%', background: 'transparent' }}
      >
        <Scene splatSrc={HAIRSTYLES[activeIdx].src} />
      </Canvas>
    </div>
  );
}
