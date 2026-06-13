'use client';

import * as THREE from 'three';

import React, { useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';

import { PLYLoader } from 'three-stdlib';

interface HairModelProps {
  plyUrl: string;
  textureUrl: string;
  color?: string;
}

export const HairModel: React.FC<HairModelProps> = ({ 
  plyUrl, 
  textureUrl, 
  color = '#4a3728' // Default dark brown hair color
}) => {
  const meshRef = useRef<THREE.Mesh>(null);

  // 1. Load the PLY geometry and the Alpha/Color texture
  const geometry = useLoader(PLYLoader, plyUrl);
  const texture = useLoader(THREE.TextureLoader, textureUrl);

  // 2. Configure geometry and texture settings
  useMemo(() => {
    if (geometry) {
      geometry.computeVertexNormals(); // Fixes web lighting/shading
      geometry.center();               // Centers the model on (0,0,0)
    }
    if (texture) {
      texture.colorSpace = THREE.SRGBColorSpace; // Ensures accurate color mapping
    }
  }, [geometry, texture]);

  // Optional: Add a slow rotation effect to show off the hair dimensionality
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.getElapsedTime() * 0.1;
    }
  });

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshStandardMaterial
        color={color}
        map={texture}
        alphaMap={texture}
        transparent={true}
        // alphaTest prevents back-facing hair cards from clipping/disappearing
        alphaTest={0.3} 
        // depthWrite can be set to true if alphaTest is used, otherwise set to false
        depthWrite={true} 
        side={THREE.DoubleSide} // Ensures hair is visible from the inside and outside
        roughness={0.6}
        metalness={0.1}
      />
    </mesh>
  );
};
