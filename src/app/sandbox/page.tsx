'use client';

import * as THREE from 'three';

import { OrbitControls, useGLTF } from '@react-three/drei';
import React, { Suspense, useMemo, useState } from 'react';

import { Canvas } from '@react-three/fiber';
import HairStrandMesh from '@/components/HairStrandMesh';

// ── Preset styles ─────────────────────────────────────────────
const STYLES = [
  { id: 'bob_cut',         label: 'Bob Cut',        pcCount: 3 },
  { id: 'long_straight',   label: 'Long Straight',  pcCount: 3 },
  { id: 'long_wavy',       label: 'Long Wavy',      pcCount: 3 },
  { id: 'long_curly',      label: 'Long Curly',     pcCount: 3 },
  { id: 'pixie_cut',       label: 'Pixie Cut',      pcCount: 3 },
  { id: 'afro',            label: 'Afro',           pcCount: 3 },
  { id: 'bun_top',         label: 'Bun Top',        pcCount: 3 },
  { id: 'bun_low',         label: 'Bun Low',        pcCount: 3 },
  { id: 'ponytail_high',   label: 'Ponytail High',  pcCount: 3 },
  { id: 'short_curly',     label: 'Short Curly',    pcCount: 3 },
  { id: 'medium_wavy',     label: 'Medium Wavy',    pcCount: 3 },
  { id: 'loose_curls',     label: 'Loose Curls',    pcCount: 3 },
];

// Same alignment constants as HairScene
const HAIR_SCALE = 13.109;
const HAIR_POS: [number, number, number] = [0, -23.149, 0.7];

// ── Preset head (Bruno Polycam) ───────────────────────────────
function PresetHead() {
  const { scene } = useGLTF('bruno_polycam.glb');

  const { scale, pos } = useMemo(() => {
    scene.updateWorldMatrix(true, true);
    const box    = new THREE.Box3().setFromObject(scene);
    const size   = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = (1.6 / Math.max(size.x, 0.001)) * 5 * 0.7 * 1.2;
    const h = size.y * s;
    return {
      scale: s,
      pos: [
        -center.x * s - h * 0.045,
        -center.y * s - h * 0.3,
        -center.z * s + h * 0.10,
      ] as [number, number, number],
    };
  }, [scene]);

  return (
    <group
      scale={scale}
      rotation={[3 * Math.PI / 180, 35 * Math.PI / 180, -6 * Math.PI / 180]}
      position={pos}
    >
      <primitive object={scene} castShadow receiveShadow />
    </group>
  );
}

// ── 3D scene ──────────────────────────────────────────────────
interface SceneProps {
  styleId: string;
  pcCount: number;
  hairColor: string;
  combMode: boolean;
  brushRadius: number;
  brushStrength: number;
}

function Scene({ styleId, pcCount, hairColor, combMode, brushRadius, brushStrength }: SceneProps) {
  const urls = Array.from({ length: pcCount }, (_, i) =>
    `/inference_results/${styleId}/upsampled_hairstyle/pc_${i}.ply`
  );

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]} intensity={1.0} castShadow />
      <directionalLight position={[0, 2, 5]}  intensity={0.8} />

      <Suspense fallback={null}>
        <PresetHead />
      </Suspense>

      {urls.map((url, i) => (
        <HairStrandMesh
          key={`${styleId}-${i}`}
          url={url}
          color={hairColor}
          scale={HAIR_SCALE}
          position={HAIR_POS}
          lineWidth={0.8}
          renderOrder={0}
          combMode={combMode}
          brushRadiusPx={brushRadius}
          brushStrength={brushStrength}
        />
      ))}

      <OrbitControls
        enabled={!combMode}
        enablePan={false}
        minPolarAngle={0}
        maxPolarAngle={Math.PI / 2 + (10 * Math.PI / 180)}
        minDistance={2.5}
        maxDistance={7.8}
      />
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────
export default function SandboxPage() {
  const [selectedStyle, setSelectedStyle] = useState(STYLES[0]);
  const [hairColor, setHairColor] = useState('#3b1f0a');
  const [combMode, setCombMode] = useState(false);
  const [brushRadius, setBrushRadius] = useState(80);
  const [brushStrength, setBrushStrength] = useState(0.4);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0a0a0a', display: 'flex', fontFamily: 'system-ui, sans-serif' }}>

      {/* ── 3D viewport ── */}
      <div style={{ flex: 1, position: 'relative' }}>
        <Canvas
          shadows
          gl={{ toneMapping: THREE.NoToneMapping, preserveDrawingBuffer: true }}
          camera={{ position: [0, 0, 7.8], fov: 45 }}
          style={{ width: '100%', height: '100%' }}
        >
          <Scene
            styleId={selectedStyle.id}
            pcCount={selectedStyle.pcCount}
            hairColor={hairColor}
            combMode={combMode}
            brushRadius={brushRadius}
            brushStrength={brushStrength}
          />
        </Canvas>

        {combMode && (
          <div style={{
            position: 'absolute',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(255,200,80,0.12)',
            border: '1px solid rgba(255,200,80,0.45)',
            color: '#ffc850',
            padding: '5px 14px',
            borderRadius: 20,
            fontSize: 12,
            pointerEvents: 'none',
          }}>
            Comb mode — drag to style
          </div>
        )}
      </div>

      {/* ── Controls panel ── */}
      <div style={{
        width: 220,
        background: '#111',
        borderLeft: '1px solid #1e1e1e',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        color: '#ccc',
        fontSize: 13,
      }}>
        <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid #1e1e1e', fontWeight: 600, color: '#fff', fontSize: 14 }}>
          Hair Sandbox
        </div>

        {/* Comb */}
        <PanelSection label="Comb Tool">
          <button
            onClick={() => setCombMode(v => !v)}
            style={{
              width: '100%',
              padding: '8px 0',
              borderRadius: 7,
              border: combMode ? '1px solid rgba(255,200,80,0.6)' : '1px solid #2a2a2a',
              background: combMode ? 'rgba(255,200,80,0.1)' : '#1a1a1a',
              color: combMode ? '#ffc850' : '#888',
              cursor: 'pointer',
              fontSize: 13,
              transition: 'all 0.15s',
            }}
          >
            {combMode ? '✦ Comb ON' : 'Comb OFF'}
          </button>
          <RangeRow label="Brush radius" value={brushRadius} min={20} max={200} step={5}
            display={`${brushRadius}px`} onChange={setBrushRadius} />
          <RangeRow label="Strength" value={brushStrength} min={0.05} max={1.0} step={0.05}
            display={brushStrength.toFixed(2)} onChange={setBrushStrength} />
        </PanelSection>

        {/* Color */}
        <PanelSection label="Hair Color">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <input
              type="color"
              value={hairColor}
              onChange={e => setHairColor(e.target.value)}
              style={{ width: 30, height: 30, border: 'none', background: 'none', cursor: 'pointer', padding: 0, borderRadius: 4 }}
            />
            <span style={{ color: '#555', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{hairColor}</span>
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {['#0f0d0c', '#3b1f0a', '#7c4a1e', '#c8a050', '#dca850', '#b0a090', '#e8e0d0', '#555'].map(c => (
              <button
                key={c}
                onClick={() => setHairColor(c)}
                title={c}
                style={{
                  width: 20, height: 20,
                  borderRadius: '50%',
                  background: c,
                  border: hairColor === c ? '2px solid #fff' : '2px solid #333',
                  cursor: 'pointer',
                  padding: 0,
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
        </PanelSection>

        {/* Style picker */}
        <PanelSection label="Style">
          {STYLES.map(style => (
            <button
              key={style.id}
              onClick={() => setSelectedStyle(style)}
              style={{
                width: '100%',
                padding: '7px 8px',
                borderRadius: 6,
                border: 'none',
                background: selectedStyle.id === style.id ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: selectedStyle.id === style.id ? '#fff' : '#666',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: 13,
                transition: 'all 0.1s',
              }}
            >
              {style.label}
            </button>
          ))}
        </PanelSection>
      </div>
    </div>
  );
}

// ── UI primitives ─────────────────────────────────────────────
function PanelSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 14px', borderBottom: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function RangeRow({ label, value, min, max, step, display, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  display: string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 12, color: '#666' }}>
        <span>{label}</span>
        <span style={{ color: '#999', fontVariantNumeric: 'tabular-nums' }}>{display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#ffc850' }}
      />
    </div>
  );
}
