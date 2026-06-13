'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Splat } from '@react-three/drei';
import * as THREE from 'three';
import { GaussianData, buildPlyBlob, buildSplatBlob, parsePly, projectToScreen } from './plyUtils';

interface Props {
  plyUrl: string;
  height?: number;
}

// Inner component that captures camera + gl refs from R3F context
function SceneCapture({
  cameraRef,
  glRef,
}: {
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  glRef:     React.MutableRefObject<THREE.WebGLRenderer | null>;
}) {
  const { camera, gl } = useThree();
  useEffect(() => {
    cameraRef.current = camera;
    glRef.current = gl;
  }, [camera, gl, cameraRef, glRef]);
  return null;
}

const MAX_UNDO = 50;

// Trigger a browser download of a Blob
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export default function ErasableSplatViewer({ plyUrl, height = 400 }: Props) {
  const [gaussians,    setGaussians]    = useState<GaussianData | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [loadError,    setLoadError]    = useState<string | null>(null);
  const [splatBlobUrl, setSplatBlobUrl] = useState<string | null>(null);
  const [eraserMode,   setEraserMode]   = useState(false);
  const [brushRadius,  setBrushRadius]  = useState(30);
  const [deletedCount, setDeletedCount] = useState(0);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [cursorPos,    setCursorPos]    = useState<{ x: number; y: number } | null>(null);

  // Refs that don't need re-renders
  const gaussiansRef   = useRef<GaussianData | null>(null);
  const deletedRef     = useRef<Set<number>>(new Set());
  const undoStack      = useRef<number[][]>([]);
  const strokeRef      = useRef<number[]>([]);
  const cameraRef      = useRef<THREE.Camera | null>(null);
  const glRef          = useRef<THREE.WebGLRenderer | null>(null);
  const containerRef   = useRef<HTMLDivElement>(null);
  const splatUrlRef    = useRef<string | null>(null);
  const isDragging     = useRef(false);
  const screenPosRef   = useRef<Float32Array | null>(null);
  const brushRadiusRef = useRef(30);

  // Keep brushRadiusRef in sync
  useEffect(() => { brushRadiusRef.current = brushRadius; }, [brushRadius]);

  // Log every splatBlobUrl change so we can see what <Splat> receives
  useEffect(() => {
    if (splatBlobUrl) {
      console.log(`[ErasableSplatViewer] splatBlobUrl changed → ${splatBlobUrl}`);
    }
  }, [splatBlobUrl]);

  // Load PLY on mount / url change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setGaussians(null);
    setSplatBlobUrl(null);
    setDeletedCount(0);
    setUndoAvailable(false);
    deletedRef.current = new Set();
    undoStack.current = [];
    strokeRef.current = [];
    screenPosRef.current = null;

    (async () => {
      try {
        console.log(`[ErasableSplatViewer] fetching PLY: ${plyUrl}`);
        const res = await fetch(plyUrl);
        console.log(`[ErasableSplatViewer] fetch response: status=${res.status}, ok=${res.ok}, content-type=${res.headers.get('content-type')}, content-length=${res.headers.get('content-length')}`);
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching PLY`);
        const buf = await res.arrayBuffer();
        console.log(`[ErasableSplatViewer] downloaded buffer: ${buf.byteLength} bytes`);
        if (cancelled) return;

        const g = parsePly(buf);
        console.log(`[ErasableSplatViewer] parsePly done: count=${g.count}, stride=${g.stride}, props=${Object.keys(g.propOffset).join(',')}`);
        gaussiansRef.current = g;
        setGaussians(g);

        // Build initial splat blob
        const blob = buildSplatBlob(g, new Set());
        console.log(`[ErasableSplatViewer] initial blob: size=${blob.size}, divisible32=${blob.size % 32 === 0}`);
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        console.log(`[ErasableSplatViewer] blob URL created: ${url}`);
        splatUrlRef.current = url;
        setSplatBlobUrl(url);
      } catch (err) {
        console.error(`[ErasableSplatViewer] load error:`, err);
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      // Revoke with delay so Splat (which fetches the URL itself) has time to finish.
      // Immediate revocation causes "Failed to parse file" in React Strict Mode because
      // state still holds the URL after cleanup, and Splat tries to fetch the revoked URL.
      const urlToRevoke = splatUrlRef.current;
      if (urlToRevoke) {
        splatUrlRef.current = null;
        setTimeout(() => URL.revokeObjectURL(urlToRevoke), 5000);
      }
    };
  }, [plyUrl]);

  // Rebuild splat from current deleted set
  const rebuildSplat = useCallback(() => {
    const g = gaussiansRef.current;
    if (!g) return;

    const blob = buildSplatBlob(g, deletedRef.current);
    console.log(`[ErasableSplatViewer] rebuildSplat blob: size=${blob.size}, divisible32=${blob.size % 32 === 0}`);
    const newUrl = URL.createObjectURL(blob);
    console.log(`[ErasableSplatViewer] rebuildSplat new URL: ${newUrl}`);

    const oldUrl = splatUrlRef.current;
    splatUrlRef.current = newUrl;
    setSplatBlobUrl(newUrl);
    setDeletedCount(deletedRef.current.size);
    setUndoAvailable(undoStack.current.length > 0);

    // Delay revoke so the renderer finishes with old URL
    if (oldUrl) setTimeout(() => URL.revokeObjectURL(oldUrl), 2000);
  }, []);

  // Compute screen-space positions and store in ref
  const computeScreenPositions = useCallback(() => {
    const g = gaussiansRef.current;
    const camera = cameraRef.current;
    const gl = glRef.current;
    if (!g || !camera || !gl) return;

    camera.updateMatrixWorld();

    const proj = (camera as THREE.PerspectiveCamera).projectionMatrix;
    const worldInv = camera.matrixWorldInverse;
    const mvp = new THREE.Matrix4().multiplyMatrices(proj, worldInv);

    const w = gl.domElement.clientWidth;
    const h = gl.domElement.clientHeight;

    screenPosRef.current = projectToScreen(g.positions, mvp.elements, w, h);
  }, []);

  // Erase gaussians within brush radius of (x, y)
  const eraseAt = useCallback((x: number, y: number) => {
    const sp = screenPosRef.current;
    if (!sp) return;
    const r = brushRadiusRef.current;
    const r2 = r * r;
    const count = sp.length / 2;

    for (let i = 0; i < count; i++) {
      if (deletedRef.current.has(i)) continue;
      const dx = sp[i * 2 + 0] - x;
      const dy = sp[i * 2 + 1] - y;
      if (dx * dx + dy * dy <= r2) {
        deletedRef.current.add(i);
        strokeRef.current.push(i);
      }
    }
  }, []);

  // Get mouse coordinates relative to container
  const getXY = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  // Mouse handlers — only meaningful in eraser mode
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!eraserMode) return;
    isDragging.current = true;
    strokeRef.current = [];
    computeScreenPositions();
    const { x, y } = getXY(e);
    eraseAt(x, y);
  }, [eraserMode, computeScreenPositions, eraseAt, getXY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!eraserMode) return;
    const { x, y } = getXY(e);
    setCursorPos({ x, y });
    if (isDragging.current) eraseAt(x, y);
  }, [eraserMode, eraseAt, getXY]);

  const commitStroke = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (strokeRef.current.length > 0) {
      undoStack.current = [...undoStack.current.slice(-MAX_UNDO + 1), [...strokeRef.current]];
      strokeRef.current = [];
      rebuildSplat();
    }
  }, [rebuildSplat]);

  const handleMouseLeave = useCallback(() => {
    setCursorPos(null);
    commitStroke();
  }, [commitStroke]);

  // Undo last stroke
  const handleUndo = useCallback(() => {
    const last = undoStack.current.pop();
    if (!last) return;
    for (const idx of last) deletedRef.current.delete(idx);
    rebuildSplat();
  }, [rebuildSplat]);

  // Clear all deletions
  const handleUndoAll = useCallback(() => {
    deletedRef.current = new Set();
    undoStack.current = [];
    rebuildSplat();
  }, [rebuildSplat]);

  // Export handlers
  const handleExportPly = useCallback(() => {
    const g = gaussiansRef.current;
    if (!g) return;
    const blob = buildPlyBlob(g, deletedRef.current);
    downloadBlob(blob, 'hair_edited.ply');
  }, []);

  const handleExportSplat = useCallback(() => {
    const g = gaussiansRef.current;
    if (!g) return;
    const blob = buildSplatBlob(g, deletedRef.current);
    downloadBlob(blob, 'hair_edited.splat');
  }, []);

  const toggleEraserMode = useCallback(() => {
    setEraserMode(prev => !prev);
    setCursorPos(null);
  }, []);

  // Shared button base style
  const btnBase: React.CSSProperties = {
    background: '#161209',
    border: '1px solid #443',
    color: '#887',
    padding: '4px 10px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: 11,
  };

  const btnDisabled: React.CSSProperties = {
    ...btnBase,
    color: '#332',
    cursor: 'not-allowed',
    opacity: 0.6,
  };

  const eraserActiveBtn: React.CSSProperties = {
    ...btnBase,
    background: '#3a2c10',
    border: '1px solid #ffe39a',
    color: '#ffe39a',
    fontWeight: 700,
  };

  const total = gaussians?.count ?? 0;
  const remaining = total - deletedCount;

  return (
    <div>
      {/* 3D viewport */}
      <div
        ref={containerRef}
        style={{ position: 'relative', height, overflow: 'hidden', userSelect: eraserMode ? 'none' : undefined }}
        onMouseDown={eraserMode ? handleMouseDown : undefined}
        onMouseMove={eraserMode ? handleMouseMove : undefined}
        onMouseUp={eraserMode ? commitStroke : undefined}
        onMouseLeave={eraserMode ? handleMouseLeave : undefined}
      >
        {/* Loading overlay */}
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            background: '#0a0805',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'monospace', fontSize: 12, color: '#665',
          }}>
            loading PLY…
          </div>
        )}

        {/* Error overlay */}
        {loadError && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            background: '#0a0805',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'monospace', fontSize: 12, color: '#d63c2f',
            padding: '0 20px', textAlign: 'center',
          }}>
            {loadError}
          </div>
        )}

        {/* Cursor blocking overlay in eraser mode (stops orbit events reaching Canvas) */}
        {eraserMode && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 4,
            cursor: 'crosshair',
            // transparent — just captures pointer events
          }} />
        )}

        <Canvas
          camera={{ position: [0, 0, 4], fov: 60 }}
          style={{ background: '#0a0805', width: '100%', height: '100%' }}
        >
          <SceneCapture cameraRef={cameraRef} glRef={glRef} />
          {splatBlobUrl && (
            <Splat key={splatBlobUrl} src={splatBlobUrl} />
          )}
          <OrbitControls
            autoRotate={!eraserMode}
            autoRotateSpeed={0.8}
            enabled={!eraserMode}
          />
        </Canvas>

        {/* Brush cursor circle */}
        {eraserMode && cursorPos && (
          <div
            style={{
              position: 'absolute',
              left:   cursorPos.x - brushRadius,
              top:    cursorPos.y - brushRadius,
              width:  brushRadius * 2,
              height: brushRadius * 2,
              borderRadius: '50%',
              border: '2px solid rgba(255,200,50,0.9)',
              background: 'rgba(255,200,50,0.08)',
              pointerEvents: 'none',
              zIndex: 6,
            }}
          />
        )}
      </div>

      {/* Toolbar */}
      <div style={{
        background: '#0e0c09',
        borderTop: '1px solid #2a2218',
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
      }}>
        {/* Eraser toggle */}
        <button
          onClick={toggleEraserMode}
          style={eraserMode ? eraserActiveBtn : btnBase}
        >
          {eraserMode ? '[ ERASER ON ]' : '[ ERASER ]'}
        </button>

        {/* Brush controls — only in eraser mode */}
        {eraserMode && (
          <>
            <span style={{ color: '#665', fontSize: 10, fontFamily: 'monospace' }}>
              brush
            </span>
            <input
              type="range"
              min={5}
              max={120}
              step={1}
              value={brushRadius}
              onChange={e => setBrushRadius(Number(e.target.value))}
              style={{ accentColor: '#ffe39a', width: 80 }}
            />
            <span style={{ color: '#ffe39a', fontSize: 10, fontFamily: 'monospace', minWidth: 22 }}>
              {brushRadius}
            </span>

            <button
              onClick={handleUndo}
              disabled={!undoAvailable}
              style={undoAvailable ? btnBase : btnDisabled}
            >
              undo
            </button>
            <button
              onClick={handleUndoAll}
              disabled={deletedCount === 0}
              style={deletedCount > 0 ? btnBase : btnDisabled}
            >
              clear all
            </button>
          </>
        )}

        {/* Erased count stat */}
        {deletedCount > 0 && (
          <span style={{ color: '#887', fontSize: 10, fontFamily: 'monospace' }}>
            {deletedCount.toLocaleString()} erased
            {total > 0 && (
              <> ({total.toLocaleString()} total → {remaining.toLocaleString()} remaining)</>
            )}
          </span>
        )}

        {/* Export buttons */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={handleExportPly} style={btnBase}>
            ↓ export .ply
          </button>
          <button onClick={handleExportSplat} style={btnBase}>
            ↓ export .splat
          </button>
        </div>
      </div>

      {/* Hint text */}
      <div style={{
        textAlign: 'center',
        fontSize: 11,
        fontFamily: 'monospace',
        color: '#665',
        paddingTop: 5,
        paddingBottom: 6,
        background: '#0a0805',
      }}>
        {eraserMode
          ? 'click and drag to erase · orbit disabled'
          : 'drag to orbit · scroll to zoom · enable eraser to edit'}
      </div>
    </div>
  );
}
