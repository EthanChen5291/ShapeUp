'use client';

import * as THREE from 'three';

import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { parsePLYWithBBox } from '@/lib/parsePLY';

// Scene light directions (world space) — must match HairScene.tsx directionalLights.
const LIGHT1_WS = new THREE.Vector3(5, 10, 5).normalize();
const LIGHT2_WS = new THREE.Vector3(0,  2, 5).normalize();

/**
 * Patch a freshly-created LineMaterial with Kajiya-Kay hair shading.
 *
 * LineMaterial expands each edge into a screen-space quad. The two endpoints
 * are available as `instanceStart` / `instanceEnd` in the vertex shader, so
 * we derive the strand tangent there and interpolate it to the fragment.
 *
 * KK diffuse  = sin(angle(T, L))
 * KK specular = (T·L · T·V + sin_TL · sin_TV) ^ shininess
 */
function applyKajiyaKay(mat: LineMaterial): void {
  mat.uniforms.uKKLight1WS = { value: LIGHT1_WS.clone() };
  mat.uniforms.uKKLight2WS = { value: LIGHT2_WS.clone() };

  mat.onBeforeCompile = (shader) => {
    // Forward the KK uniforms into the actual shader program
    shader.uniforms.uKKLight1WS = mat.uniforms.uKKLight1WS;
    shader.uniforms.uKKLight2WS = mat.uniforms.uKKLight2WS;

    // ── Vertex shader ────────────────────────────────────────────────────────
    // Declare varyings + uniforms before main()
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      /* glsl */`
        uniform vec3 uKKLight1WS;
        uniform vec3 uKKLight2WS;
        varying vec3 vKKTangent;
        varying vec3 vViewPos;
        varying vec3 vKKLight1;
        varying vec3 vKKLight2;
        varying vec3 vRadialNorm;
        void main() {`,
    );

    // After start/end are computed in view space, derive tangent + lights +
    // radial normal (position used as proxy for outward surface normal on a
    // roughly-spherical head; gives lit/shadow sides to the head).
    shader.vertexShader = shader.vertexShader.replace(
      'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );',
      /* glsl */`
        vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );
        vKKTangent  = normalize((end - start).xyz);
        vViewPos    = (position.y < 0.5) ? start.xyz : end.xyz;
        vKKLight1   = normalize(mat3(viewMatrix) * uKKLight1WS);
        vKKLight2   = normalize(mat3(viewMatrix) * uKKLight2WS);
        vec3 instancePos = (position.y < 0.5) ? instanceStart : instanceEnd;
        // Subtract PLY-space head center so the radial normal correctly
        // points outward from the head surface, not toward world Y-up.
        // PLY bbox center is at approx (0, 1.72, -0.016) in model space.
        vRadialNorm = normalize(mat3(modelViewMatrix) * (instancePos - vec3(0.0, 1.72, -0.016)));`,
    );

    // ── Fragment shader ──────────────────────────────────────────────────────
    // Declare varyings before main()
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      /* glsl */`
        varying vec3 vKKTangent;
        varying vec3 vViewPos;
        varying vec3 vKKLight1;
        varying vec3 vKKLight2;
        varying vec3 vRadialNorm;
        void main() {`,
    );

    // Replace the final color output with Kajiya-Kay
    shader.fragmentShader = shader.fragmentShader.replace(
      'gl_FragColor = vec4( diffuseColor.rgb, alpha );',
      /* glsl */`
        vec3  T    = normalize(vKKTangent);
        vec3  V    = normalize(-vViewPos);
        vec3  N    = normalize(vRadialNorm);

        float TL1 = dot(T, vKKLight1); float sinTL1 = sqrt(max(0.0, 1.0 - TL1*TL1));
        float TL2 = dot(T, vKKLight2); float sinTL2 = sqrt(max(0.0, 1.0 - TL2*TL2));
        float TV  = dot(T, V);         float sinTV  = sqrt(max(0.0, 1.0 - TV *TV ));

        // KK diffuse, normalized to [0,1] across both lights
        float diff = (sinTL1 * 1.0 + sinTL2 * 0.8) / 1.8;

        // Position-based facing factor: strands on the shadow side of the head
        // receive less diffuse. Remap dot(N,L) from [-1,1] → [0,1] with a soft
        // minimum so the back never goes fully dark.
        float face1   = dot(N, vKKLight1);
        float face2   = dot(N, vKKLight2);
        float face_raw = face1 * 0.7 + face2 * 0.3;
        float facing  = clamp(face_raw * 0.5 + 0.5, 0.15, 1.0);

        // Self-shadowing proxy: when the strand's surface-normal faces BOTH the
        // viewer and the lights (e.g. looking down from above with overhead lights),
        // reduce diffuse to prevent the flat "everything uniformly lit" look.
        // Has no effect when viewer and light are on opposite sides.
        float normFacingViewer = max(0.0, dot(N, V));
        float selfShadow       = max(0.0, 1.0 - normFacingViewer * max(0.0, face_raw) * 0.85);

        float spec = pow(max(0.0, TL1*TV + sinTL1*sinTV), 80.0) * 1.0
                   + pow(max(0.0, TL2*TV + sinTL2*sinTV), 80.0) * 0.8;

        vec3 specColor = vec3(0.95, 0.78, 0.50);
        vec3 kkColor   = diffuseColor.rgb * (0.30 + diff * facing * selfShadow * 0.65)
                       + specColor * spec * 0.09;

        gl_FragColor = vec4(kkColor, alpha);`,
    );
  };
}

export type PLYBBox = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

interface HairStrandMeshProps {
  url: string;
  color?: string;
  scale?: number;
  position?: [number, number, number];
  renderOrder?: number;
  lineWidth?: number;
  onBBoxReady?: (bbox: PLYBBox) => void;
  combMode?: boolean;
  brushRadiusPx?: number;
  brushStrength?: number;
}

interface HairData {
  lineSegs: LineSegments2;
}

export default function HairStrandMesh({
  url,
  color = '#3b1f0a',
  scale = 1,
  position = [0, 0, 0],
  renderOrder = 0,
  lineWidth = 1.2,
  onBBoxReady,
  combMode = false,
  brushRadiusPx = 80,
  brushStrength = 0.4,
}: HairStrandMeshProps) {
  const { size, camera, gl } = useThree();
  const [hairData, setHairData] = useState<HairData | null>(null);
  const hairDataRef = useRef<HairData | null>(null);

  // Comb state
  const strandsRef    = useRef<Strand[]>([]);
  const lsGeoRef      = useRef<LineSegmentsGeometry | null>(null);
  const segBufRef     = useRef<Float32Array | null>(null);
  const dirtyRef      = useRef(false);
  const isPaintingRef = useRef(false);
  const lastPtrRef    = useRef<{ x: number; y: number } | null>(null);
  // Pointer events are batched here and applied once per useFrame to cap latency at render rate
  const pendingCombRef = useRef<{ cx: number; cy: number; dx: number; dy: number } | null>(null);
  // Updated every render so event handlers always see current props/camera
  const applyRef = useRef<(cx: number, cy: number, dx: number, dy: number) => void>(() => {});
  applyRef.current = (cx: number, cy: number, dx: number, dy: number): void => {
    const strands = strandsRef.current;
    if (!strands.length) return;
    const rect = gl.domElement.getBoundingClientRect();
    const toNDC = (px: number, py: number) =>
      new THREE.Vector2(
        ((px - rect.left) / rect.width) * 2 - 1,
        -((py - rect.top) / rect.height) * 2 + 1,
      );
    const r0 = strands[0].pts[0];
    const depthNDC = new THREE.Vector3(
      r0[0] * scale + position[0],
      r0[1] * scale + position[1],
      r0[2] * scale + position[2],
    ).project(camera).z;
    const curNDC  = toNDC(cx, cy);
    const prevNDC = toNDC(cx - dx, cy - dy);
    const delta3D = new THREE.Vector3(curNDC.x, curNDC.y, depthNDC)
      .unproject(camera)
      .sub(new THREE.Vector3(prevNDC.x, prevNDC.y, depthNDC).unproject(camera));

    for (const strand of strands) {
      const rp   = strand.pts[0];
      const proj = new THREE.Vector3(
        rp[0] * scale + position[0],
        rp[1] * scale + position[1],
        rp[2] * scale + position[2],
      ).project(camera);
      if (proj.z > 1) continue; // behind camera
      const sx   = ( proj.x * 0.5 + 0.5) * rect.width  + rect.left;
      const sy   = (-proj.y * 0.5 + 0.5) * rect.height + rect.top;
      const dist = Math.hypot(sx - cx, sy - cy);
      if (dist >= brushRadiusPx) continue;
      const falloff = 1 - (dist / brushRadiusPx) ** 2;
      const len = strand.pts.length;
      for (let i = 1; i < len; i++) {
        const tip = i / (len - 1);
        const w   = falloff * brushStrength * tip;
        strand.pts[i][0] += (delta3D.x / scale) * w;
        strand.pts[i][1] += (delta3D.y / scale) * w;
        strand.pts[i][2] += (delta3D.z / scale) * w;
      }
    }
  };

  // Apply pending comb input + flush dirty positions — both capped to render rate
  useFrame(() => {
    if (pendingCombRef.current) {
      const { cx, cy, dx, dy } = pendingCombRef.current;
      pendingCombRef.current = null;
      applyRef.current(cx, cy, dx, dy);
      dirtyRef.current = true;
    }
    if (!dirtyRef.current || !lsGeoRef.current || !segBufRef.current) return;
    dirtyRef.current = false;
    const buf = segBufRef.current;
    let idx = 0;
    for (const s of strandsRef.current) {
      for (let i = 0; i < s.pts.length - 1; i++) {
        const a = s.pts[i], b = s.pts[i + 1];
        buf[idx++] = a[0]; buf[idx++] = a[1]; buf[idx++] = a[2];
        buf[idx++] = b[0]; buf[idx++] = b[1]; buf[idx++] = b[2];
      }
    }
    lsGeoRef.current.setPositions(buf);
  });

  useEffect(() => {
    if (!combMode || !hairData) return;
    const el = gl.domElement;
    const onDown = (e: PointerEvent) => { isPaintingRef.current = true; lastPtrRef.current = { x: e.clientX, y: e.clientY }; };
    const onMove = (e: PointerEvent) => {
      if (!isPaintingRef.current || !lastPtrRef.current) return;
      const dx = e.clientX - lastPtrRef.current.x;
      const dy = e.clientY - lastPtrRef.current.y;
      // Accumulate into pending — useFrame applies it at render rate, not pointer rate
      if (pendingCombRef.current) {
        pendingCombRef.current.cx = e.clientX;
        pendingCombRef.current.cy = e.clientY;
        pendingCombRef.current.dx += dx;
        pendingCombRef.current.dy += dy;
      } else {
        pendingCombRef.current = { cx: e.clientX, cy: e.clientY, dx, dy };
      }
      lastPtrRef.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => { isPaintingRef.current = false; lastPtrRef.current = null; };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup',   onUp);
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); };
  }, [combMode, hairData]);


  useEffect(() => {
    let cancelled = false;
    parsePLYWithBBox(url).then(({ geometry: geo, bbox }) => {
      if (cancelled) { geo.dispose(); return; }

      const posAttr   = geo.attributes.position as THREE.BufferAttribute;
      const indexAttr = geo.getIndex()!;

      // ── Parse guides into strand arrays ──────────────────────────────────
      const guides = parseStrandsFromSegments(posAttr, indexAttr);

      // ── Generate children ─────────────────────────────────────────────────
      // childrenPerGuide=5 → ~5x density. Keep total under ~20k strands
      // for 60fps. If guides.length > 3000 reduce childrenPerGuide to 2.
      const childrenPerGuide = guides.length > 3000 ? 2 : 5;
      const children = interpolateChildStrands(guides, childrenPerGuide, 3, 0.004);
      const allStrands = [...guides, ...children];

      // ── Rebuild flat segment list from all strands ────────────────────────
      let segCount = 0;
      for (const strand of allStrands) segCount += strand.pts.length - 1;
      const segBuf = new Float32Array(segCount * 6);
      let idx = 0;
      for (const strand of allStrands) {
        for (let i = 0; i < strand.pts.length - 1; i++) {
          const a = strand.pts[i], b = strand.pts[i + 1];
          segBuf[idx++] = a[0]; segBuf[idx++] = a[1]; segBuf[idx++] = a[2];
          segBuf[idx++] = b[0]; segBuf[idx++] = b[1]; segBuf[idx++] = b[2];
        }
      }

      const lsGeo = new LineSegmentsGeometry();
      lsGeo.setPositions(segBuf);

      strandsRef.current = allStrands;
      lsGeoRef.current = lsGeo;
      segBufRef.current = segBuf;

      const mat = new LineMaterial({
        color: new THREE.Color(color).getHex(),
        linewidth: lineWidth,
        resolution: new THREE.Vector2(size.width, size.height),
      });
      applyKajiyaKay(mat);

      const ls = new LineSegments2(lsGeo, mat);
      ls.scale.set(scale, scale, scale);
      ls.position.set(...position);
      ls.renderOrder = renderOrder;

      geo.dispose();

      const data: HairData = { lineSegs: ls };
      hairDataRef.current = data;
      setHairData(data);
      onBBoxReady?.(bbox);
    });
    return () => {
      cancelled = true;
      if (hairDataRef.current) {
        hairDataRef.current.lineSegs.geometry.dispose();
        (hairDataRef.current.lineSegs.material as LineMaterial).dispose();
        hairDataRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Reactively update scale/position when props change (e.g. after FLAME data arrives)
  useEffect(() => {
    if (!hairDataRef.current) return;
    hairDataRef.current.lineSegs.scale.set(scale, scale, scale);
    hairDataRef.current.lineSegs.position.set(...position);
  }, [scale, position[0], position[1], position[2]]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Keep resolution in sync when canvas resizes
  useEffect(() => {
    if (!hairDataRef.current) return;
    (hairDataRef.current.lineSegs.material as LineMaterial).resolution.set(size.width, size.height);
  }, [size]);

  // Update color/lineWidth reactively
  useEffect(() => {
    if (!hairDataRef.current) return;
    const mat = hairDataRef.current.lineSegs.material as LineMaterial;
    mat.color.set(color);
    mat.linewidth = lineWidth;
  }, [color, lineWidth]);

  if (!hairData) return null;

  return <primitive object={hairData.lineSegs} />;
}


// ── Strand interpolation (children) ─────────────────────────────────────────
// Takes the parsed strand array and floods it with interpolated children,
// mimicking Blender's "children" feature.
//
// Strategy:
//   1. Group vertices back into per-strand arrays
//   2. Build a spatial index of strand roots
//   3. For each guide strand, find K nearest neighbors by root position
//   4. Generate `childrenPerGuide` children by randomly blending between
//      the guide and one of its neighbors, with a small noise offset
//
// This runs on the CPU at load time (~50ms for 3k guides → 15k children).

interface Strand { pts: [number, number, number][] }

function parseStrandsFromSegments(
  posAttr: THREE.BufferAttribute,
  indexAttr: THREE.BufferAttribute,
): Strand[] {
  // Reconstruct strands from the edge list.
  // Edges that share a vertex are part of the same strand.
  // Build adjacency: vertex → connected vertices
  const edgeCount = indexAttr.count / 2;
  const next = new Map<number, number>(); // a → b for each edge a-b

  for (let i = 0; i < edgeCount; i++) {
    const a = indexAttr.getX(i * 2);
    const b = indexAttr.getX(i * 2 + 1);
    next.set(a, b);
  }

  // Find strand roots: vertices that are never a "b" (never pointed to)
  const isTarget = new Set<number>();
  next.forEach((b) => isTarget.add(b));

  const strands: Strand[] = [];
  next.forEach((_, start) => {
    if (isTarget.has(start)) return; // not a root
    const pts: [number, number, number][] = [];
    let cur: number | undefined = start;
    while (cur !== undefined) {
      pts.push([posAttr.getX(cur), posAttr.getY(cur), posAttr.getZ(cur)]);
      cur = next.get(cur);
    }
    if (pts.length >= 2) strands.push({ pts });
  });

  return strands;
}

function interpolateChildStrands(
  strands: Strand[],
  childrenPerGuide = 4,    // children per guide strand
  kNeighbors       = 3,    // how many neighbors to blend from
  noiseScale       = 0.004 // positional jitter on children
): Strand[] {
  if (strands.length === 0) return strands;

  // Resample all strands to uniform point count for easy interpolation
  const TARGET_PTS = 16;

  function resample(strand: Strand, n: number): [number,number,number][] {
    const src = strand.pts;
    if (src.length === n) return src;
    const out: [number,number,number][] = [];
    for (let i = 0; i < n; i++) {
      const t   = i / (n - 1);
      const raw = t * (src.length - 1);
      const lo  = Math.floor(raw);
      const hi  = Math.min(lo + 1, src.length - 1);
      const f   = raw - lo;
      out.push([
        src[lo][0] + (src[hi][0] - src[lo][0]) * f,
        src[lo][1] + (src[hi][1] - src[lo][1]) * f,
        src[lo][2] + (src[hi][2] - src[lo][2]) * f,
      ]);
    }
    return out;
  }

  const resampled = strands.map(s => resample(s, TARGET_PTS));

  // Build flat root position array for neighbor search
  const roots = resampled.map(s => s[0]);

  function nearestK(rootIdx: number, k: number): number[] {
    const rx = roots[rootIdx][0], ry = roots[rootIdx][1], rz = roots[rootIdx][2];
    const dists = roots.map((r, i) => {
      if (i === rootIdx) return Infinity;
      const dx = r[0]-rx, dy = r[1]-ry, dz = r[2]-rz;
      return dx*dx + dy*dy + dz*dz;
    });
    return dists
      .map((d, i) => ({ d, i }))
      .sort((a, b) => a.d - b.d)
      .slice(0, k)
      .map(x => x.i);
  }

  // Seeded random (deterministic so it doesn't re-jitter on re-render)
  let seed = 42;
  function rand(): number {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0xffffffff;
  }

  const children: Strand[] = [];

  resampled.forEach((guide, gi) => {
    const neighbors = nearestK(gi, kNeighbors);

    for (let c = 0; c < childrenPerGuide; c++) {
      // Pick a random neighbor to blend toward
      const ni      = neighbors[Math.floor(rand() * neighbors.length)];
      const neighbor = resampled[ni];
      const t       = rand() * 0.85; // blend weight toward neighbor (never fully neighbor)

      const childPts: [number,number,number][] = guide.map((gp, pi) => {
        const np = neighbor[pi];
        // Interpolate position
        const x = gp[0] + (np[0] - gp[0]) * t;
        const y = gp[1] + (np[1] - gp[1]) * t;
        const z = gp[2] + (np[2] - gp[2]) * t;
        // Add small noise — more at tips, less at roots (hair splays at ends)
        const tipFactor = pi / (TARGET_PTS - 1);
        const n = noiseScale * (1 + tipFactor * 2.5);
        return [
          x + (rand() - 0.5) * n,
          y + (rand() - 0.5) * n * 0.4, // less vertical noise
          z + (rand() - 0.5) * n,
        ];
      });

      children.push({ pts: childPts });
    }
  });

  return children;
} 