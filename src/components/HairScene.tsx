// ============================================================
// HairScene — COCO's domain
//
// Three.js scene via react-three-fiber.
// Currently uses placeholder geometry (sphere = head, boxes = hair zones).
// Replace the geometry with loaded .glb meshes once assets are ready.
//
// Props:
//   params   — HairParams driving mesh scale
//   colorRGB — hex string for hair material
//   profile  — optional UserHeadProfile; when provided, hair zones are
//              positioned dynamically from headProportions + anchors.
//              Falls back to hardcoded positions when absent.
// ============================================================

'use client';

import * as THREE from 'three';

import { HairMeasurementBBox, HairParams, UserHeadProfile } from '@/types';
import { OrbitControls, Splat, useGLTF } from '@react-three/drei';
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import HairStrandMesh from './HairStrandMesh';
import SplatVideoCapture from './SplatVideoCapture';
import { buildCurrentProfilePayload } from '@/lib/llmPayload';

// ── Polycam head ─────────────────────────────────────────────
function PolycamHeadGLB() {
  const { scene } = useGLTF('/models/bruno_polycam.glb');

  const { scale, centerOffset, heightInScene } = useMemo(() => {
    scene.updateWorldMatrix(true, true);
    const box    = new THREE.Box3().setFromObject(scene);
    const size   = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = (1.6 / Math.max(size.x, 0.001)) * 5 * 0.7 * 1.2;
    return { scale: s, centerOffset: center, heightInScene: size.y * s };
  }, [scene]);

  return (
    <group
      scale={scale}
      rotation={[3 * Math.PI / 180, 35 * Math.PI / 180, -6 * Math.PI / 180]}
      position={[
        -centerOffset.x * scale - heightInScene * 0.045,
        -centerOffset.y * scale - heightInScene * 0.3,
        -centerOffset.z * scale + heightInScene * 0.10,
      ]}
    >
      <primitive object={scene} castShadow receiveShadow />
    </group>
  );
}

function PolycamHead() {
  return (
    <Suspense fallback={null}>
      <PolycamHeadGLB />
    </Suspense>
  );
}

// ── Scene content ───────────────────────────────────────────

// Fallback hair transform used before a measured PLY bbox is available.
// Derived by manually aligning brunohair.ply to the reference Polycam head.
const HAIR_PLY_SCALE_DEFAULT   = 13.109;
const HAIR_PLY_POS_DEFAULT: [number, number, number] = [0, -23.149, 0.7];

const ORBIT_SPEEDS = [0.25, 0.5, 1.0, 1.5, 2.5, 4.0];

// Default orbit camera framing — matches the <Canvas camera> below and the
// orbit target. The 360° capture resets to this so a zoomed-in/elevated live
// view doesn't produce a bad clip.
const DEFAULT_CAMERA_POS: [number, number, number] = [0, 0, 7.8];
const DEFAULT_ORBIT_TARGET: [number, number, number] = [0, 0, 0];

// Dev: all known hair layers. Toggle multiple simultaneously to identify pairs.
// Colors are fixed per layer so you can distinguish overlapping sets visually.
type HairLayer = { id: string; label: string; url: string; color: string; lineWidth: number; renderOrder: number; yOffset?: number };
const S3_HAIR = 'https://shape-up-s3.s3.us-east-1.amazonaws.com/hair';

const HAIR_LAYERS: HairLayer[] = [
  { id: 'pretty interesting', label: 'Modified',    url: `${S3_HAIR}/hair_modified.ply`, color: '#dca850', lineWidth: 0.8, renderOrder: 0 },
  { id: 'pretty thick',    label: 'Strands 1',   url: `${S3_HAIR}/strands_1.ply`,   color: '#3b1f0a', lineWidth: 0.8, renderOrder: 0 },
  { id: 'medium bob',     label: 'Preset A',    url: `${S3_HAIR}/preset_a.ply`,    color: '#c8a050', lineWidth: 0.8, renderOrder: 0 },
  { id: 'medium long',        label: 'Guest',       url: `${S3_HAIR}/guest.ply`,       color: '#c0b090', lineWidth: 0.8, renderOrder: 0 },
  { id: 'brunohair',    label: 'Bruno',       url: `${S3_HAIR}/brunohair.ply`,   color: '#0f0d0c', lineWidth: 0.8, renderOrder: 0 },
  { id: 'top_hair',     label: 'Top Hair',    url: `${S3_HAIR}/top_hair.ply`,    color: '#3b1f0a', lineWidth: 0.8, renderOrder: 0, yOffset: -0.3 },
];

type RawHairBBox = Omit<HairMeasurementBBox, 'width' | 'height' | 'depth'>;

// ── Keyboard camera controller ──────────────────────────────
const CAM_ROTATE_SPEED = 0.4;
const CAM_PAN_SPEED    = 1.2;
const CAM_SMOOTH       = 8;
const CAM_PHI_MIN      = 0.01;
const CAM_PHI_MAX      = Math.PI / 2 + (10 * Math.PI / 180);

function isTyping(): boolean {
  const tag = (document.activeElement as HTMLElement | null)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

function KeyboardCameraController({ orbitRef }: { orbitRef: React.RefObject<any> }) {
  const { camera, invalidate } = useThree();
  const keys    = useRef(new Set<string>());
  const velRot  = useRef({ theta: 0, phi: 0 });
  const velMove = useRef(new THREE.Vector3());

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (isTyping()) return;
      keys.current.add(e.code);
      invalidate(); // kick the demand-mode loop on first keydown
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code))
        e.preventDefault();
    };
    const onUp   = (e: KeyboardEvent) => keys.current.delete(e.code);
    const onBlur = () => keys.current.clear();
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [invalidate]);

  useFrame((_, delta) => {
    const controls = orbitRef.current;
    if (!controls) return;

    const dt   = Math.min(delta, 0.1);
    const t    = Math.min(1, CAM_SMOOTH * dt);
    const k    = keys.current;
    const busy = isTyping();

    const tTheta = busy ? 0 : (k.has('KeyD') ? CAM_ROTATE_SPEED : 0) - (k.has('KeyA') ? CAM_ROTATE_SPEED : 0);
    const tPhi   = busy ? 0 : (k.has('KeyS') ? CAM_ROTATE_SPEED : 0) - (k.has('KeyW') ? CAM_ROTATE_SPEED : 0);
    velRot.current.theta += (tTheta - velRot.current.theta) * t;
    velRot.current.phi   += (tPhi   - velRot.current.phi)   * t;

    const fwdRaw = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0);
    const fwd    = fwdRaw.lengthSq() > 1e-6 ? fwdRaw.normalize() : new THREE.Vector3(0, 0, -1);
    const right  = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const tMove  = new THREE.Vector3();
    if (!busy) {
      if (k.has('ArrowUp'))                              tMove.addScaledVector(fwd,    CAM_PAN_SPEED);
      if (k.has('ArrowDown'))                            tMove.addScaledVector(fwd,   -CAM_PAN_SPEED);
      if (k.has('ArrowRight'))                           tMove.addScaledVector(right,   CAM_PAN_SPEED);
      if (k.has('ArrowLeft'))                            tMove.addScaledVector(right,  -CAM_PAN_SPEED);
      if (k.has('Space'))                                tMove.y += CAM_PAN_SPEED;
      if (k.has('ShiftLeft') || k.has('ShiftRight'))     tMove.y -= CAM_PAN_SPEED;
    }
    velMove.current.lerp(tMove, t);

    const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
    const sph    = new THREE.Spherical().setFromVector3(offset);
    sph.theta += velRot.current.theta * dt;
    sph.phi    = Math.max(CAM_PHI_MIN, Math.min(CAM_PHI_MAX, sph.phi + velRot.current.phi * dt));
    sph.makeSafe();
    camera.position.setFromSpherical(sph).add(controls.target);

    const move = velMove.current.clone().multiplyScalar(dt);
    camera.position.add(move);
    controls.target.add(move);

    controls.update();
    // In demand mode, keep requesting frames while keys are held
    if (keys.current.size > 0) invalidate();
  });

  return null;
}


interface SceneProps {
  showPolycam?: boolean;
  showSplat?: boolean;
  visibleLayers: Set<string>;
  hairScale: number;
  hairPos: [number, number, number];
  splatScale: number;
  splatPosY: number;
  splatSrc: string;
  hairstepPlyUrl?: string;
  hairstepPlyUrls?: string[];
  hairColor?: string;
  orbitRotateSpeed?: number;
  disableKeyboardControls?: boolean;
  background?: string;
  captureKey?: number;
  renderQuality?: 'performance' | 'balanced' | 'high';
  videoCaptureKey?: number;
  captureBackground?: string;
  onVideoProgress?: (p: number) => void;
  onVideoReady?: (blob: Blob, ext: string) => void;
  onVideoError?: (err: unknown) => void;
  onPrimaryHairBBoxReady?: (bbox: RawHairBBox) => void;
  onThumbnailReady?: (dataUrl: string) => void;
}

// Sets scene.background from the CSS-style background string passed to HairScene.
// url(...) → TextureLoader; #hex / rgb(...) → THREE.Color; anything else → no-op.
function SceneBackground({ background }: { background: string }) {
  const { scene } = useThree();
  useEffect(() => {
    if (background.startsWith('url(')) {
      const path = background.match(/url\(([^)]+)\)/)?.[1] ?? '/preview_bg.jpg';
      const tex = new THREE.TextureLoader().load(path);
      scene.background = tex;
      return () => { tex.dispose(); scene.background = null; };
    }
    if (background.startsWith('#') || background.startsWith('rgb')) {
      scene.background = new THREE.Color(background);
      return () => { scene.background = null; };
    }
  }, [background, scene]);
  return null;
}

// Captures the current canvas view as a square 512×512 JPEG thumbnail.
// Center-crops gl.domElement to a square (handles any panel aspect ratio),
// then downsamples to 512×512. No camera movement — captures the user's
// current view angle with whatever scene.background is active.
// TODO: generate thumbnail server-side during facelift instead of capturing client canvas.
function ThumbnailCapture({ onCapture }: { onCapture: (dataUrl: string) => void }) {
  const { gl } = useThree();
  const doneRef = useRef(false);
  const frameRef = useRef(0);

  useFrame(() => {
    if (doneRef.current) return;
    frameRef.current += 1;
    if (frameRef.current < 3) return; // wait 3 frames to ensure scene is rendered
    doneRef.current = true;

    const SIZE = 512;
    const cw = gl.domElement.width;
    const ch = gl.domElement.height;
    const side = Math.min(cw, ch);
    const sx = (cw - side) / 2;
    const sy = (ch - side) / 2;
    const thumb = document.createElement('canvas');
    thumb.width = SIZE;
    thumb.height = SIZE;
    thumb.getContext('2d')!.drawImage(gl.domElement, sx, sy, side, side, 0, 0, SIZE, SIZE);
    onCapture(thumb.toDataURL('image/jpeg', 0.82));
  });

  return null;
}

function Scene({ showPolycam = false, showSplat = true, visibleLayers, hairScale, hairPos, splatScale, splatPosY, splatSrc, hairstepPlyUrl, hairstepPlyUrls, hairColor, orbitRotateSpeed = 1, disableKeyboardControls = false, background, captureKey, renderQuality = 'balanced', videoCaptureKey, captureBackground, onVideoProgress, onVideoReady, onVideoError, onPrimaryHairBBoxReady, onThumbnailReady }: SceneProps) {
  const orbitRef = useRef<any>(null);
  console.log('[Scene] render — showSplat:', showSplat, '| splatSrc:', splatSrc?.substring(0, 80));
  return (
    <>
      {background && <SceneBackground background={background} />}
      <ambientLight intensity={renderQuality === 'performance' ? 0.75 : 0.5} />
      <directionalLight position={[5, 10, 5]} intensity={1.0} castShadow={renderQuality !== 'performance'} />
      <directionalLight position={[0, 2, 5]}  intensity={0.8} />

      {showPolycam && <PolycamHead />}

      {showSplat && splatSrc && (
        <Suspense fallback={null}>
          <Splat key={splatSrc} src={splatSrc} alphaTest={0.02} scale={splatScale} position={[0, splatPosY, 0.48]} rotation={[-Math.PI / 2, Math.PI, Math.PI]} />
        </Suspense>
      )}

      {HAIR_LAYERS.filter(l => visibleLayers.has(l.id)).map(l => (
        <HairStrandMesh
          key={l.id}
          url={l.url}
          color={hairColor ?? l.color}
          scale={hairScale}
          position={'yOffset' in l ? [hairPos[0], hairPos[1] + (l as {yOffset:number}).yOffset, hairPos[2]] : hairPos}
          lineWidth={l.lineWidth}
          renderOrder={l.renderOrder}
          renderQuality={renderQuality}
          onBBoxReady={l.id === 'hair_modified' ? onPrimaryHairBBoxReady : undefined}
        />
      ))}

      {hairstepPlyUrl && (() => {
        const lw = renderQuality === 'performance' ? 0.6 : renderQuality === 'high' ? 0.9 : 0.8;
        const passes = renderQuality === 'high' ? 3 : 1;
        const offsets: [number, number, number][] = [
          [0, 0, 0],
          [0.003, 0.003, 0],
          [-0.003, -0.003, 0],
        ];
        return (
          <>
            {Array.from({ length: passes }, (_, pi) => (
              <HairStrandMesh
                key={`hairstep-${pi}`}
                url={hairstepPlyUrl}
                color={hairColor ?? "#3b1f0a"}
                scale={hairScale}
                position={[hairPos[0] + offsets[pi][0], hairPos[1] + offsets[pi][1], hairPos[2] + offsets[pi][2]]}
                lineWidth={lw}
                renderOrder={pi}
                renderQuality={renderQuality}
                onBBoxReady={pi === 0 ? onPrimaryHairBBoxReady : undefined}
              />
            ))}
            {visibleLayers.has('top_hair') && (
              <HairStrandMesh
                url={`${S3_HAIR}/top_hair.ply`}
                color={hairColor ?? "#3b1f0a"}
                scale={hairScale}
                position={[hairPos[0], hairPos[1] - 0.3, hairPos[2]]}
                lineWidth={lw}
                renderOrder={0}
                renderQuality={renderQuality}
              />
            )}
          </>
        );
      })()}

      {hairstepPlyUrls?.map((url, i) => (
        <HairStrandMesh
          key={`demo-${i}`}
          url={url}
          color={hairColor ?? '#3b1f0a'}
          scale={hairScale}
          position={hairPos}
          lineWidth={0.8}
          renderOrder={0}
          renderQuality={renderQuality}
        />
      ))}

      <OrbitControls
        ref={orbitRef}
        enablePan={false}
        minPolarAngle={0}
        maxPolarAngle={Math.PI / 2 + (10 * Math.PI / 180)}
        minDistance={2.5}
        maxDistance={7.8}
        rotateSpeed={orbitRotateSpeed}
      />
      {!disableKeyboardControls && <KeyboardCameraController orbitRef={orbitRef} />}
      {onThumbnailReady && <ThumbnailCapture key={captureKey ?? 0} onCapture={onThumbnailReady} />}
      <SplatVideoCapture
        captureKey={videoCaptureKey ?? 0}
        orbitRef={orbitRef}
        defaultCameraPos={DEFAULT_CAMERA_POS}
        defaultTarget={DEFAULT_ORBIT_TARGET}
        captureBackground={captureBackground}
        onProgress={onVideoProgress}
        onReady={onVideoReady}
        onError={onVideoError}
      />
    </>
  );
}

// ── Public component ────────────────────────────────────────

interface HairSceneProps {
  params:                    HairParams;
  colorRGB?:                 string;
  profile?:                  UserHeadProfile;
  autoFaceliftDataUrl?:      string;
  faceliftPlyReady?:         boolean;
  hairstepPlyUrl?:           string;
  hairstepPlyUrls?:          string[];
  splatSrcOverride?:         string | null;
  disableDefaultHairLayers?: boolean;
  disableKeyboardControls?:  boolean;
  background?:               string;
  backgroundBrightness?:     number;
  uiHidden?:                 boolean;
  captureKey?:               number;
  renderQuality?:            'performance' | 'balanced' | 'high';
  videoCaptureKey?:          number;
  onVideoProgress?:          (p: number) => void;
  onVideoReady?:             (blob: Blob, ext: string) => void;
  onVideoError?:             (err: unknown) => void;
  onPrimaryHairBBoxReady?: (bbox: RawHairBBox) => void;
  onThumbnailReady?: (dataUrl: string) => void;
}

export default function HairScene({ params: _params, colorRGB: _colorRGB, profile: _profile, autoFaceliftDataUrl, faceliftPlyReady, hairstepPlyUrl, hairstepPlyUrls, splatSrcOverride, disableDefaultHairLayers, disableKeyboardControls = false, background = 'url(/preview_bg.jpg) center / 100% 100% no-repeat', backgroundBrightness, uiHidden = false, captureKey, renderQuality = 'balanced', videoCaptureKey, onVideoProgress, onVideoReady, onVideoError, onPrimaryHairBBoxReady, onThumbnailReady }: HairSceneProps) {
  console.log('[HairScene] mount/render — splatSrcOverride:', splatSrcOverride, '| disableDefaultHairLayers:', disableDefaultHairLayers);
  const [showPolycam, setShowPolycam] = useState(false);
  const [showSplat, setShowSplat]     = useState(!!splatSrcOverride);
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(
    new Set(disableDefaultHairLayers ? [] : ['hair_modified', 'top_hair'])
  );

  // Clear default hair layers if the prop flips to true after mount (e.g. splat loads async)
  useEffect(() => {
    if (disableDefaultHairLayers) {
      setVisibleLayers(prev => {
        if (!prev.has('hair_modified') && !prev.has('top_hair')) return prev;
        const next = new Set(prev);
        next.delete('hair_modified');
        next.delete('top_hair');
        return next;
      });
    }
  }, [disableDefaultHairLayers]);

  // FaceLift job state for ethansample_bald test
  const [ethanJobId, setEthanJobId]       = useState<string | null>(null);
  const [ethanJobStatus, setEthanJobStatus] = useState<'idle' | 'submitting' | 'processing' | 'done' | 'error'>('idle');
  const [ethanSplatSrc, setEthanSplatSrc] = useState<string | null>(null);

  // Auto-submit FaceLift when a baldified image is passed in from the hair edit loop.
  // If faceliftPlyReady is true, the ply+splat were already downloaded — skip re-submission.
  useEffect(() => {
    if (!autoFaceliftDataUrl || ethanJobStatus !== 'idle') return;
    if (faceliftPlyReady) {
      const t = Date.now();
      setEthanSplatSrc(`/output.splat?t=${t}`);
      setEthanJobStatus('done');
      return;
    }
    setEthanJobStatus('submitting');
    fetch('/api/facelift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageDataUrl: autoFaceliftDataUrl,
        currentProfile: _profile ? buildCurrentProfilePayload(_profile) : null,
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.splatUrl) {
          setEthanSplatSrc(data.splatUrl);
          setEthanJobStatus('done');
        } else if (data.jobId) {
          setEthanJobId(data.jobId);
          setEthanJobStatus('processing');
        } else {
          setEthanJobStatus('error');
        }
      })
      .catch(() => setEthanJobStatus('error'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFaceliftDataUrl]);


  // Poll FaceLift until the job finishes, then set the splat + ply source URLs.
  useEffect(() => {
    if (ethanJobStatus !== 'processing' || !ethanJobId) return;
    const timer = setInterval(async () => {
      try {
        const res  = await fetch(`/api/facelift?jobId=${encodeURIComponent(ethanJobId)}`);
        const data = await res.json() as { status: string; splatUrl?: string };
        if (data.status === 'success' && data.splatUrl) {
          clearInterval(timer);
          setEthanSplatSrc(data.splatUrl);
          setEthanJobStatus('done');
        } else if (data.status === 'error') {
          clearInterval(timer);
          setEthanJobStatus('error');
        }
      } catch { /* transient — keep polling */ }
    }, 10_000);
    return () => clearInterval(timer);
  }, [ethanJobStatus, ethanJobId]);

  // Turn splat on automatically as soon as a real URL becomes available
  useEffect(() => {
    console.log('[HairScene] splat effect — splatSrcOverride:', splatSrcOverride, '| ethanSplatSrc:', ethanSplatSrc);
    if (splatSrcOverride || ethanSplatSrc) setShowSplat(true);
  }, [splatSrcOverride, ethanSplatSrc]);

  // ethanSplatSrc (FaceLift result) replaces any static fallback when ready
  const effectiveSplatSrc = splatSrcOverride ?? ethanSplatSrc ?? '';
  console.log('[HairScene] effectiveSplatSrc:', effectiveSplatSrc, '| showSplat:', showSplat);

  const hairScale = HAIR_PLY_SCALE_DEFAULT;
  const hairPos: [number, number, number] = HAIR_PLY_POS_DEFAULT;

  const [showHair, setShowHair] = useState(true);
  const [hoveredLayer, setHoveredLayer] = useState<string | null>(null);
  const [hairColor, setHairColor] = useState('#3b1f0a');
  const [cursorHidden, setCursorHidden] = useState(false);
  const [orbitSpeedIdx, setOrbitSpeedIdx] = useState(1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      if (e.code === 'KeyH') setCursorHidden(v => !v);
      if (e.code === 'KeyB') setOrbitSpeedIdx(i => (i + 1) % ORBIT_SPEEDS.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleLayer = (id: string) =>
    setVisibleLayers(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const effectiveVisibleLayers = useMemo(() => {
    if (!showHair) return new Set<string>();
    if (!hoveredLayer || visibleLayers.has(hoveredLayer)) return visibleLayers;
    const next = new Set(visibleLayers);
    next.add(hoveredLayer);
    return next;
  }, [visibleLayers, hoveredLayer, showHair]);

  // When backgroundBrightness is provided for a URL background, render the image
  // as a CSS-filtered div behind a transparent canvas so brightness only affects
  // the background plate, not the hair mesh or splat render.
  const useCssBg = backgroundBrightness !== undefined && background.startsWith('url(');
  const cssBrightnessFilter = useCssBg
    ? `brightness(${Math.max(0.05, backgroundBrightness! * 2)})`
    : undefined;

  return (
    <div
      role="region"
      aria-label="Interactive 3D hairstyle preview"
      aria-describedby="hair-scene-instructions"
      style={{ position: 'relative', width: '100%', height: '100%', cursor: cursorHidden ? 'none' : undefined }}
    >
      <p id="hair-scene-instructions" className="sr-only">
        Use pointer or touch controls to rotate and inspect the hairstyle preview.
      </p>
      {useCssBg && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background,
            filter: cssBrightnessFilter,
            zIndex: 0,
          }}
        />
      )}
      <Canvas
        shadows={renderQuality !== 'performance'}
        dpr={renderQuality === 'performance' ? 1 : renderQuality === 'balanced' ? [1, 1.5] : [1, 2]}
        frameloop={renderQuality === 'performance' ? 'demand' : 'always'}
        gl={{
          antialias: renderQuality !== 'performance',
          powerPreference: renderQuality === 'performance' ? 'low-power' : 'high-performance',
          toneMapping: THREE.NoToneMapping,
          preserveDrawingBuffer: true,
          alpha: true,
        }}
        camera={{ position: DEFAULT_CAMERA_POS, fov: 45 }}
        style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%', background: useCssBg ? 'transparent' : background }}
      >
        <Scene
          showPolycam={showPolycam}
          showSplat={showSplat}
          visibleLayers={effectiveVisibleLayers}
          hairScale={hairScale}
          hairPos={hairPos}
          splatScale={2.772}
          splatPosY={-0.07}
          splatSrc={effectiveSplatSrc}
          hairstepPlyUrl={showHair ? hairstepPlyUrl : undefined}
          hairstepPlyUrls={showHair ? hairstepPlyUrls : undefined}
          hairColor={hairColor}
          orbitRotateSpeed={ORBIT_SPEEDS[orbitSpeedIdx]}
          disableKeyboardControls={disableKeyboardControls}
          background={useCssBg ? undefined : background}
          captureKey={captureKey}
          renderQuality={renderQuality}
          videoCaptureKey={videoCaptureKey}
          captureBackground={background}
          onVideoProgress={onVideoProgress}
          onVideoReady={onVideoReady}
          onVideoError={onVideoError}
          onPrimaryHairBBoxReady={onPrimaryHairBBoxReady}
          onThumbnailReady={onThumbnailReady}
        />
      </Canvas>
    </div>
  );
}

// ============================================================
// TODO (Coco): replace placeholder geometry with .glb
//
// import { useGLTF } from '@react-three/drei';
//
// function HeadMesh() {
//   const { scene } = useGLTF('/models/head.glb');
//   return <primitive object={scene} />;
// }
//
// Use updateHairMesh(params) below to drive .glb mesh groups:
// ============================================================

export function updateHairMesh(
  scene: THREE.Object3D,
  params: HairParams
) {
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    if (child.name === 'Hair_Top') {
      child.scale.y = params.topLength;
    }
    if (child.name.startsWith('Hair_Side')) {
      child.scale.y = params.sideLength;
      child.scale.x = 1 - params.taper * 0.5;
    }
    if (child.name === 'Hair_Back') {
      child.scale.y = params.backLength;
    }

    if (child.name.startsWith('Hair_') && child.material instanceof THREE.MeshStandardMaterial) {
      child.material.roughness = 0.5 + params.messiness * 0.5;
    }
  });
}
