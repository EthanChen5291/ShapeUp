// ============================================================
// SplatVideoCapture — records a 360° loop of the splat to a video blob.
//
// Rendered INSIDE the r3f <Canvas> (inside <Scene>). When `captureKey` bumps to
// a new value > 0, it runs an async capture loop:
//   • saves camera / target / background / controls state
//   • bakes a solid scene.background (the live bg may be a CSS plate, not in GL)
//   • sweeps the camera azimuth over [0, 2π) around the orbit target
//   • settles each frame for the splat's async re-sort, draws to an offscreen
//     canvas (even dims, capped resolution), and feeds it to the encoder
//   • restores all saved state so the live view is untouched
//
// The encoder ([recordSplatVideo.ts]) prefers WebCodecs → .mp4, else webm.
// ============================================================

'use client';

import * as THREE from 'three';
import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { createSplatEncoder } from '@/lib/recordSplatVideo';
import { createWatermark } from '@/lib/splatWatermark';

const FRAMES = 120;          // 4s loop at 30fps
const FPS = 30;
const SETTLE_FRAMES = 2;     // rAF ticks to let the splat worker re-sort per view
const MAX_DIM = 1080;        // cap the long edge to keep encode fast

const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

interface SplatVideoCaptureProps {
  captureKey: number;
  orbitRef: React.RefObject<{ target: THREE.Vector3; enabled: boolean; update: () => void } | null>;
  /** Default camera position to reset to before the 360° sweep (defines radius + polar angle). */
  defaultCameraPos?: [number, number, number];
  /** Default orbit target to sweep around. */
  defaultTarget?: [number, number, number];
  /** CSS-style background string (#hex, rgb(...), or url(...)) to bake into the clip. */
  captureBackground?: string;
  onProgress?: (p: number) => void;
  onReady?: (blob: Blob, ext: string) => void;
  onError?: (err: unknown) => void;
}

function resolveBackground(value: string | undefined): THREE.Color | THREE.Texture | null {
  if (!value) return null;
  if (value.startsWith('url(')) {
    const path = value.match(/url\(([^)]+)\)/)?.[1]?.replace(/['"]/g, '') ?? '/preview_bg.jpg';
    return new THREE.TextureLoader().load(path);
  }
  if (value.startsWith('#') || value.startsWith('rgb')) return new THREE.Color(value);
  return null;
}

export default function SplatVideoCapture({
  captureKey,
  orbitRef,
  defaultCameraPos = [0, 0, 7.8],
  defaultTarget = [0, 0, 0],
  captureBackground,
  onProgress,
  onReady,
  onError,
}: SplatVideoCaptureProps) {
  const { gl, scene, camera, invalidate } = useThree();
  const lastKeyRef = useRef(0);
  const cancelledRef = useRef(false);

  useEffect(() => () => { cancelledRef.current = true; }, []);

  useEffect(() => {
    if (captureKey <= 0 || captureKey === lastKeyRef.current) return;
    lastKeyRef.current = captureKey;

    let bakedBg: THREE.Texture | null = null;
    const controls = orbitRef.current;

    // Save state to restore afterwards.
    const savedCamPos = camera.position.clone();
    const savedQuat = camera.quaternion.clone();
    const savedTarget = controls?.target.clone() ?? null;
    const savedBg = scene.background;
    const savedControlsEnabled = controls?.enabled ?? true;

    // Reset to the default orbit framing before sweeping, so a zoomed-in or
    // elevated live view doesn't produce a bad 360° clip. We ignore the live
    // camera/target entirely and orbit at the default radius + polar angle.
    const target = new THREE.Vector3(...defaultTarget);
    const offset = new THREE.Vector3(...defaultCameraPos).sub(target);
    const startSph = new THREE.Spherical().setFromVector3(offset);

    // Offscreen encode target — even dims, capped resolution.
    const bufW = gl.domElement.width;
    const bufH = gl.domElement.height;
    const scaleDown = Math.min(1, MAX_DIM / Math.max(bufW, bufH));
    const outW = Math.max(2, Math.floor((bufW * scaleDown) / 2) * 2);
    const outH = Math.max(2, Math.floor((bufH * scaleDown) / 2) * 2);
    const off = document.createElement('canvas');
    off.width = outW;
    off.height = outH;
    const offCtx = off.getContext('2d');

    let encoder: Awaited<ReturnType<typeof createSplatEncoder>> | null = null;

    const run = async () => {
      if (!offCtx) { onError?.(new Error('no 2d context')); return; }
      try {
        if (controls) controls.enabled = false;

        // Bake a real GL background (the live bg can be a CSS plate behind a
        // transparent canvas, which would record as black/transparent).
        const resolved = resolveBackground(captureBackground);
        if (resolved instanceof THREE.Texture) bakedBg = resolved;
        if (resolved) scene.background = resolved;
        else if (!scene.background) scene.background = new THREE.Color('#1c1510');

        // Brand the clip with the ShapeUp corner lockup (comb + wordmark),
        // built once and stamped into every frame's bottom-left corner.
        const watermark = await createWatermark({ videoHeight: outH }).catch(() => null);

        encoder = await createSplatEncoder({ canvas: off, width: outW, height: outH, fps: FPS });
        encoder.start();

        for (let i = 0; i < FRAMES; i++) {
          if (cancelledRef.current) { encoder.cancel(); return; }
          const stepStart = performance.now();

          // Position camera at this azimuth and aim at the orbit target.
          const sph = new THREE.Spherical(startSph.radius, startSph.phi, startSph.theta + (i / FRAMES) * Math.PI * 2);
          sph.makeSafe();
          camera.position.setFromSpherical(sph).add(target);
          camera.lookAt(target);
          camera.updateMatrixWorld();

          // Kick the r3f loop so the <Splat>'s useFrame runs and requests a
          // re-sort for this view (a bare gl.render wouldn't, in demand mode).
          // Settle a couple frames for the async sort worker, then render once
          // more to guarantee the freshest, fully sorted pixels on the canvas.
          invalidate();
          for (let s = 0; s < SETTLE_FRAMES; s++) await raf();
          invalidate();
          await raf();
          gl.render(scene, camera);

          offCtx.drawImage(gl.domElement, 0, 0, outW, outH);
          if (watermark) {
            offCtx.drawImage(watermark.canvas, watermark.margin, outH - watermark.height - watermark.margin);
          }
          encoder.addFrame();
          onProgress?.((i + 1) / FRAMES);

          // The webm fallback records in realtime — pace the loop to hold FPS.
          if (encoder.realtime) {
            const elapsed = performance.now() - stepStart;
            const budget = 1000 / FPS;
            if (elapsed < budget) await new Promise((r) => setTimeout(r, budget - elapsed));
          }
        }

        const { blob, ext } = await encoder.finish();
        if (!cancelledRef.current) onReady?.(blob, ext);
      } catch (err) {
        encoder?.cancel();
        if (!cancelledRef.current) onError?.(err);
      } finally {
        // Restore the live scene exactly as it was.
        scene.background = savedBg;
        if (bakedBg) bakedBg.dispose();
        camera.position.copy(savedCamPos);
        camera.quaternion.copy(savedQuat);
        camera.updateMatrixWorld();
        if (controls) {
          if (savedTarget) controls.target.copy(savedTarget);
          controls.enabled = savedControlsEnabled;
          controls.update();
        }
      }
    };

    run();
  }, [captureKey, gl, scene, camera, orbitRef, defaultCameraPos, defaultTarget, captureBackground, onProgress, onReady, onError]);

  return null;
}
