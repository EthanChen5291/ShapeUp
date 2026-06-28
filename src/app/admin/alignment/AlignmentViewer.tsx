'use client';

// AlignmentViewer — renders the bald HEAD splat and the HAIR splat in the same scene,
// with the active alignment transform applied to the hair, so you can see the hair ply
// connecting to the head ply. A manual nudge (offset + scale) lets you fine-tune on top
// of whichever of the six solutions is selected.

import { OrbitControls, Splat } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import * as THREE from 'three';
import type { AlignTransform } from './alignmentMath';

const TAG = '[AlignmentViewer]';

export interface ManualNudge {
  dx: number; dy: number; dz: number; scale: number;
}

interface Props {
  headSplatUrl: string;
  hairSplatUrl: string;
  transform:    AlignTransform;
  nudge:        ManualNudge;
  showHead:     boolean;
  showHair:     boolean;
  /** true = stochastic opaque mode: splats write depth and occlude instead of blending see-through */
  alphaHash?:   boolean;
  height?:      number;
}

// Compose the solution transform with the manual nudge into final position/quat/scale
// props for the hair group.
function composeHair(t: AlignTransform, n: ManualNudge) {
  const base = new THREE.Matrix4().compose(
    new THREE.Vector3(t.position[0], t.position[1], t.position[2]),
    new THREE.Quaternion(t.quaternion[0], t.quaternion[1], t.quaternion[2], t.quaternion[3]),
    new THREE.Vector3(t.scale, t.scale, t.scale),
  );
  const manual = new THREE.Matrix4().compose(
    new THREE.Vector3(n.dx, n.dy, n.dz),
    new THREE.Quaternion(),
    new THREE.Vector3(n.scale, n.scale, n.scale),
  );
  // manual applied in world space on top of the solution
  const final = new THREE.Matrix4().multiplyMatrices(manual, base);
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  final.decompose(pos, quat, scl);
  return {
    position: [pos.x, pos.y, pos.z] as [number, number, number],
    quaternion: quat,
    scale: [scl.x, scl.y, scl.z] as [number, number, number],
  };
}

function Scene({ headSplatUrl, hairSplatUrl, transform, nudge, showHead, showHair, alphaHash = false }: Props) {
  const hair = composeHair(transform, nudge);
  console.log(`${TAG} Scene: method=${transform.id} pos=${hair.position.map(n => n.toFixed(2)).join(',')} scale=${hair.scale[0].toFixed(2)} alphaHash=${alphaHash}`);
  return (
    <>
      <Suspense fallback={null}>
        {showHead && <Splat src={headSplatUrl} alphaHash={alphaHash} />}
        {showHair && (
          <group
            position={hair.position}
            quaternion={hair.quaternion}
            scale={hair.scale}
          >
            <Splat src={hairSplatUrl} alphaHash={alphaHash} />
          </group>
        )}
      </Suspense>
      <OrbitControls autoRotate autoRotateSpeed={0.7} makeDefault />
    </>
  );
}

export default function AlignmentViewer(props: Props) {
  const { height = 460 } = props;
  return (
    <div style={{ width: '100%', height, overflow: 'hidden' }}>
      <Canvas
        camera={{ position: [0, 0, 4], fov: 55 }}
        style={{ background: '#0a0805' }}
        onCreated={({ gl }) => console.log(`${TAG} Canvas created (${gl.constructor.name})`)}
      >
        <Scene {...props} />
      </Canvas>
      <div style={{
        textAlign: 'center', fontSize: 11, fontFamily: 'monospace',
        color: '#665', paddingTop: 6, paddingBottom: 6, background: '#0a0805',
      }}>
        drag to orbit · scroll to zoom · head + hair shown together
      </div>
    </div>
  );
}
