'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { useThree } from '@react-three/fiber';
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
  renderQuality?: 'performance' | 'balanced' | 'high';
  onBBoxReady?: (bbox: PLYBBox) => void;
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
  renderQuality = 'balanced',
  onBBoxReady,
}: HairStrandMeshProps) {
  const { size } = useThree();
  const [hairData, setHairData] = useState<HairData | null>(null);
  const hairDataRef = useRef<HairData | null>(null);

  useEffect(() => {
    let cancelled = false;
    parsePLYWithBBox(url).then(({ geometry: geo, bbox }) => {
      if (cancelled) { geo.dispose(); return; }

      const posAttr   = geo.attributes.position as THREE.BufferAttribute;
      const indexAttr = geo.getIndex()!;
      const edgeCount = indexAttr.count / 2;

      const segments: number[] = [];
      for (let i = 0; i < edgeCount; i++) {
        const a = indexAttr.getX(i * 2);
        const b = indexAttr.getX(i * 2 + 1);
        segments.push(
          posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a),
          posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b),
        );
      }

      const lsGeo = new LineSegmentsGeometry();
      lsGeo.setPositions(segments);

      const mat = new LineMaterial({
        color: new THREE.Color(color).getHex(),
        linewidth: lineWidth,
        resolution: new THREE.Vector2(size.width, size.height),
      });
      if (renderQuality !== 'performance') applyKajiyaKay(mat);

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
  }, [url, renderQuality]);

  // Reactively update scale/position when props change.
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
