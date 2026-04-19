'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { useThree } from '@react-three/fiber';
import { HairParams } from '@/types';
import { parsePLYStrands } from '@/lib/parsePLYStrands';
import { blendStrands, strandsToSegments } from '@/lib/blendHair';

interface Props {
  params: HairParams;
  baseUrl: string;
  color?: string;
  scale?: number;
  position?: [number, number, number];
  lineWidth?: number;
}

export default function BlendedHairMesh({
  params,
  baseUrl,
  color = '#3b1f0a',
  scale = 1,
  position = [0, 0, 0],
  lineWidth = 0.8,
}: Props) {
  const { size } = useThree();
  const [lineSegs, setLineSegs] = useState<LineSegments2 | null>(null);
  const lsRef = useRef<LineSegments2 | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseStrandsRef = useRef<Float32Array[] | null>(null);

  useEffect(() => {
    parsePLYStrands(baseUrl).then(s => { baseStrandsRef.current = s; });
  }, [baseUrl]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      const qs = new URLSearchParams({
        pc1: String(params.pc1), pc2: String(params.pc2),
        pc3: String(params.pc3), pc4: String(params.pc4),
        pc5: String(params.pc5), pc6: String(params.pc6),
      });

      const [baseStrands, res] = await Promise.all([
        baseStrandsRef.current ? Promise.resolve(baseStrandsRef.current) : parsePLYStrands(baseUrl),
        fetch(`/api/hair-ply?${qs}`).catch(() => null),
      ]);

      if (!res?.ok) return;
      const targetStrands = await parsePLYStrands(await res.arrayBuffer());

      const blended  = blendStrands(baseStrands, targetStrands, 0.5);
      const segments = strandsToSegments(blended);

      const lsGeo = new LineSegmentsGeometry();
      lsGeo.setPositions(segments);

      const mat = new LineMaterial({
        color: new THREE.Color(color).getHex(),
        linewidth: lineWidth,
        resolution: new THREE.Vector2(size.width, size.height),
      });

      const ls = new LineSegments2(lsGeo, mat);
      ls.scale.set(scale, scale, scale);
      ls.position.set(...position);

      if (lsRef.current) {
        lsRef.current.geometry.dispose();
        (lsRef.current.material as LineMaterial).dispose();
      }
      lsRef.current = ls;
      setLineSegs(ls);
    }, 500);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.pc1, params.pc2, params.pc3, params.pc4, params.pc5, params.pc6, baseUrl]);

  useEffect(() => () => {
    if (lsRef.current) {
      lsRef.current.geometry.dispose();
      (lsRef.current.material as LineMaterial).dispose();
    }
  }, []);

  if (!lineSegs) return null;
  return <primitive object={lineSegs} />;
}
