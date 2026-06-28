'use client';

// alignmentMath.ts — six strategies for snapping a hair ply onto a bald head ply.
//
// The hair gaussians were extracted (subtracted) from the ORIGINAL scan, while the
// bald head came from a SEPARATE FaceLift run on the Gemini-baldified photo. Those two
// runs do not share an exact coordinate frame, so we need a transform that places the
// hair shell back on top of the scalp. Each "solution" below computes that transform a
// different way and returns it as a decomposed { position, quaternion, scale } so it can
// be applied directly to a <group> wrapping the hair <Splat>.
//
// All functions are pure and operate on Float32Array position buffers ([x,y,z, x,y,z, ...]).

import * as THREE from 'three';

const TAG = '[alignmentMath]';
function dbg(msg: string, ...args: unknown[]) {
  console.log(`${TAG} ${msg}`, ...args);
}

// ─── basic point-cloud statistics ──────────────────────────────────────────────

export type Axis = 'x' | 'y' | 'z';
const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };

export interface CloudStats {
  count:    number;
  centroid: THREE.Vector3;
  min:      THREE.Vector3;
  max:      THREE.Vector3;
  size:     THREE.Vector3;     // max - min
  center:   THREE.Vector3;     // bbox center
  /** principal axes (unit), columns sorted by descending variance */
  axes:     [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  /** variance along each principal axis (descending) */
  eigen:    [number, number, number];
}

export function computeStats(positions: Float32Array): CloudStats {
  const count = positions.length / 3;
  const centroid = new THREE.Vector3();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

  for (let i = 0; i < count; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    centroid.x += x; centroid.y += y; centroid.z += z;
    if (x < min.x) min.x = x; if (y < min.y) min.y = y; if (z < min.z) min.z = z;
    if (x > max.x) max.x = x; if (y > max.y) max.y = y; if (z > max.z) max.z = z;
  }
  centroid.multiplyScalar(1 / Math.max(1, count));

  // 3x3 covariance (symmetric) about the centroid
  let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0;
  for (let i = 0; i < count; i++) {
    const dx = positions[i * 3]     - centroid.x;
    const dy = positions[i * 3 + 1] - centroid.y;
    const dz = positions[i * 3 + 2] - centroid.z;
    cxx += dx * dx; cyy += dy * dy; czz += dz * dz;
    cxy += dx * dy; cxz += dx * dz; cyz += dy * dz;
  }
  const inv = 1 / Math.max(1, count);
  const cov = [cxx * inv, cxy * inv, cxz * inv,
               cxy * inv, cyy * inv, cyz * inv,
               cxz * inv, cyz * inv, czz * inv];

  const { values, vectors } = jacobiEigenSymmetric(cov, 3);
  // sort descending by eigenvalue
  const order = [0, 1, 2].sort((a, b) => values[b] - values[a]);
  const axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
    columnVec3(vectors, order[0]),
    columnVec3(vectors, order[1]),
    columnVec3(vectors, order[2]),
  ];
  const eigen: [number, number, number] = [values[order[0]], values[order[1]], values[order[2]]];

  const size = new THREE.Vector3().subVectors(max, min);
  const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);

  return { count, centroid, min, max, size, center, axes, eigen };
}

function columnVec3(m: number[], col: number): THREE.Vector3 {
  // m is row-major NxN with N=3
  return new THREE.Vector3(m[0 * 3 + col], m[1 * 3 + col], m[2 * 3 + col]);
}

// ─── transform result ───────────────────────────────────────────────────────────

export interface AlignTransform {
  id:          string;
  label:       string;
  description: string;
  position:    [number, number, number];
  quaternion:  [number, number, number, number]; // x, y, z, w
  scale:       number;
  /** optional per-solution diagnostics shown in the UI */
  meta?:       Record<string, string>;
}

function fromMatrix(
  id: string, label: string, description: string,
  m: THREE.Matrix4, meta?: Record<string, string>,
): AlignTransform {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  m.decompose(pos, quat, scl);
  return {
    id, label, description,
    position:   [pos.x, pos.y, pos.z],
    quaternion: [quat.x, quat.y, quat.z, quat.w],
    scale:      (scl.x + scl.y + scl.z) / 3,
    meta,
  };
}

/** Compose a similarity transform that first scales+rotates about `pivot`, then translates. */
function similarityMatrix(R: THREE.Matrix4, s: number, t: THREE.Vector3): THREE.Matrix4 {
  // world = R*s*world + t  → build as Translation * Rotation * Scale
  const m = new THREE.Matrix4();
  m.copy(R);
  m.scale(new THREE.Vector3(s, s, s));
  m.setPosition(t);
  return m;
}

// ════════════════════════════════════════════════════════════════════════════════
//  THE SIX SOLUTIONS
//  Each takes (hair stats/positions, head stats/positions, options) → AlignTransform.
// ════════════════════════════════════════════════════════════════════════════════

export interface AlignOptions {
  upAxis:      Axis;     // which axis points toward the crown of the head
  upSign:      1 | -1;   // +1 if larger coordinate == higher on the head
  icpIters:    number;   // iterations for the ICP solution
  sampleCount: number;   // max points sampled for the heavy solutions
}

export const DEFAULT_OPTIONS: AlignOptions = {
  upAxis: 'y', upSign: 1, icpIters: 12, sampleCount: 1500,
};

// ── 1 · Raw overlay (identity) ───────────────────────────────────────────────────
// Trust FaceLift's native frames. Because the bald photo is just the original photo
// with the hair edited out, both scans usually reconstruct in a near-identical pose,
// so the hair frequently lands close to correct with no transform at all.
export function solveRawOverlay(): AlignTransform {
  return fromMatrix(
    'raw', '1 · Raw overlay',
    'No transform — overlays the hair in FaceLift\'s native coordinate frame. The bald photo is the original with hair removed, so the two scans are often already close.',
    new THREE.Matrix4().identity(),
    { transform: 'identity' },
  );
}

// ── 2 · Centroid match (translation only) ────────────────────────────────────────
// Slide the hair so its centroid sits on the head's centroid. Cheap, rotation-free,
// good when FaceLift drifts the whole cloud but keeps orientation.
export function solveCentroidMatch(hair: CloudStats, head: CloudStats): AlignTransform {
  const t = new THREE.Vector3().subVectors(head.centroid, hair.centroid);
  return fromMatrix(
    'centroid', '2 · Centroid match',
    'Translation only — moves the hair centroid onto the head centroid. Corrects positional drift while keeping FaceLift\'s orientation.',
    new THREE.Matrix4().makeTranslation(t.x, t.y, t.z),
    { translate: t.toArray().map(n => n.toFixed(3)).join(', ') },
  );
}

// ── 3 · Crown snap (sit hair on the scalp) ───────────────────────────────────────
// Match the hair's two horizontal axes to the head, then drop the bottom of the hair
// shell onto the top (crown) of the head along the chosen up-axis. This is the
// physically intuitive "rest the wig on the head" placement.
export function solveCrownSnap(hair: CloudStats, head: CloudStats, opts: AlignOptions): AlignTransform {
  const t = crownSnapTranslation(hair, head, opts, 1);
  return fromMatrix(
    'crown', '3 · Crown snap',
    `Centers the hair horizontally over the head, then seats the bottom of the hair shell onto the crown along the ${opts.upSign > 0 ? '+' : '-'}${opts.upAxis} axis.`,
    new THREE.Matrix4().makeTranslation(t.x, t.y, t.z),
    { upAxis: `${opts.upSign > 0 ? '+' : '-'}${opts.upAxis}` },
  );
}

// ── 4 · Scale-to-fit + crown snap ────────────────────────────────────────────────
// Like crown snap, but first uniformly rescales the hair so its horizontal footprint
// matches the head's. Fixes the common case where the two FaceLift runs differ in
// absolute scale.
export function solveScaleFit(
  hair: CloudStats, head: CloudStats, hairPos: Float32Array, opts: AlignOptions,
): AlignTransform {
  const ai = AXIS_INDEX[opts.upAxis];
  const horiz = [0, 1, 2].filter(i => i !== ai);
  const hairHoriz = Math.max(hair.size.getComponent(horiz[0]), hair.size.getComponent(horiz[1]));
  const headHoriz = Math.max(head.size.getComponent(horiz[0]), head.size.getComponent(horiz[1]));
  const s = hairHoriz > 1e-6 ? headHoriz / hairHoriz : 1;

  // Scale about the hair centroid, then crown-snap the scaled cloud.
  const scaled = scalePositions(hairPos, hair.centroid, s);
  const scaledStats = computeStats(scaled);
  const t = crownSnapTranslation(scaledStats, head, opts, 1);

  // world = s*(p - c) + c + t  →  build matrix: translate(c+t) * scale(s) * translate(-c)
  const m = new THREE.Matrix4()
    .makeTranslation(hair.centroid.x + t.x, hair.centroid.y + t.y, hair.centroid.z + t.z)
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-hair.centroid.x, -hair.centroid.y, -hair.centroid.z));

  return fromMatrix(
    'scalefit', '4 · Scale-to-fit + crown',
    'Uniformly rescales the hair so its horizontal footprint matches the head, then crown-snaps. Fixes scale mismatch between the two FaceLift runs.',
    m,
    { scale: s.toFixed(3), fit: `${hairHoriz.toFixed(2)}→${headHoriz.toFixed(2)}` },
  );
}

// ── 5 · PCA axis alignment ───────────────────────────────────────────────────────
// Rotate the hair so its principal axes line up with the head's principal axes, then
// match centroids. Corrects orientation drift (head tilt / roll) between the two runs.
export function solvePcaAlign(hair: CloudStats, head: CloudStats): AlignTransform {
  // Disambiguate axis signs so the hair axes point the same general way as the head's.
  const hairAxes = hair.axes.map(v => v.clone());
  for (let k = 0; k < 3; k++) {
    if (hairAxes[k].dot(head.axes[k]) < 0) hairAxes[k].multiplyScalar(-1);
  }
  // R maps hair-axis-frame → head-axis-frame:  R = Head * Hairᵀ
  const Hh = basisMatrix(head.axes[0], head.axes[1], head.axes[2]);
  const Hr = basisMatrix(hairAxes[0], hairAxes[1], hairAxes[2]);
  const R = new THREE.Matrix4().multiplyMatrices(Hh, transpose4(Hr));
  enforceRotation(R);

  // world = R*(p - hairCentroid) + headCentroid
  const t = new THREE.Vector3().copy(head.centroid)
    .sub(applyLinear(R, hair.centroid));
  const m = similarityMatrix(R, 1, t);

  return fromMatrix(
    'pca', '5 · PCA axis align',
    'Aligns the hair\'s principal axes (from PCA) to the head\'s, then matches centroids. Corrects head tilt/roll differences between the two scans.',
    m,
    {
      hairEig: hair.eigen.map(e => e.toFixed(3)).join('/'),
      headEig: head.eigen.map(e => e.toFixed(3)).join('/'),
    },
  );
}

// ── 6 · ICP refine (iterative closest point) ─────────────────────────────────────
// Initialise from the crown snap, then iteratively pull the inner (lower) shell of the
// hair onto the upper scalp of the head: nearest-neighbour correspondences → rigid fit
// (Horn's quaternion method) → repeat. This is the most accurate "snap" because it lets
// the actual geometry settle into contact.
export function solveIcpRefine(
  hairPos: Float32Array, headPos: Float32Array,
  hair: CloudStats, head: CloudStats, opts: AlignOptions,
): AlignTransform {
  // Start from the crown snap so ICP begins near the basin of attraction.
  const t0 = crownSnapTranslation(hair, head, opts, 1);
  let M = new THREE.Matrix4().makeTranslation(t0.x, t0.y, t0.z);

  // Sample the hair's lower shell (points nearest the scalp) and the head's upper shell.
  const ai = AXIS_INDEX[opts.upAxis];
  const hairSrc = sampleShell(hairPos, opts.sampleCount, ai, opts.upSign, 'low');
  const headDst = sampleShell(headPos, opts.sampleCount, ai, opts.upSign, 'high');

  let lastRms = Infinity;
  let iterRun = 0;
  for (let it = 0; it < opts.icpIters; it++) {
    iterRun = it + 1;
    // Transform the source by the current estimate.
    const moved = transformPositions(hairSrc, M);
    // Nearest-neighbour correspondences moved → headDst.
    const { P, Q, rms } = correspondences(moved, headDst);
    // Best rigid transform mapping P → Q.
    const delta = hornRigid(P, Q);
    M = new THREE.Matrix4().multiplyMatrices(delta, M);
    if (Math.abs(lastRms - rms) < 1e-5) { lastRms = rms; break; }
    lastRms = rms;
  }

  return fromMatrix(
    'icp', '6 · ICP refine',
    'Starts from the crown snap, then iteratively fits the inner hair shell to the upper scalp using nearest-neighbour point-to-point ICP (Horn\'s quaternion solver). The most accurate contact fit.',
    M,
    { iters: String(iterRun), rms: lastRms === Infinity ? 'n/a' : lastRms.toFixed(4) },
  );
}

// Convenience: run every solution and return them in order.
export function solveAll(
  hairPos: Float32Array, headPos: Float32Array, opts: AlignOptions,
): AlignTransform[] {
  const t0 = performance.now();
  const hair = computeStats(hairPos);
  const head = computeStats(headPos);
  dbg(`solveAll: hair count=${hair.count}, head count=${head.count}`);
  const out = [
    solveRawOverlay(),
    solveCentroidMatch(hair, head),
    solveCrownSnap(hair, head, opts),
    solveScaleFit(hair, head, hairPos, opts),
    solvePcaAlign(hair, head),
    solveIcpRefine(hairPos, headPos, hair, head, opts),
  ];
  dbg(`solveAll: done in ${(performance.now() - t0).toFixed(1)}ms`);
  return out;
}

// ════════════════════════════════════════════════════════════════════════════════
//  helpers
// ════════════════════════════════════════════════════════════════════════════════

// Translation that horizontally centers `hair` over `head` and seats hair's bottom on
// head's top along the up-axis, with an optional overlap factor (1 = touching).
function crownSnapTranslation(
  hair: CloudStats, head: CloudStats, opts: AlignOptions, overlap: number,
): THREE.Vector3 {
  const ai = AXIS_INDEX[opts.upAxis];
  const t = new THREE.Vector3();
  for (let i = 0; i < 3; i++) {
    if (i === ai) {
      // Seat hair's contact edge against head's crown edge.
      const headCrown = opts.upSign > 0 ? head.max.getComponent(i) : head.min.getComponent(i);
      const hairEdge  = opts.upSign > 0 ? hair.min.getComponent(i) : hair.max.getComponent(i);
      // Let the hair sink in a little so the shell overlaps the scalp instead of floating.
      const sink = head.size.getComponent(i) * 0.18 * overlap;
      t.setComponent(i, headCrown - hairEdge - opts.upSign * sink);
    } else {
      t.setComponent(i, head.center.getComponent(i) - hair.center.getComponent(i));
    }
  }
  return t;
}

function scalePositions(pos: Float32Array, about: THREE.Vector3, s: number): Float32Array {
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    out[i]     = (pos[i]     - about.x) * s + about.x;
    out[i + 1] = (pos[i + 1] - about.y) * s + about.y;
    out[i + 2] = (pos[i + 2] - about.z) * s + about.z;
  }
  return out;
}

function transformPositions(pos: Float32Array, m: THREE.Matrix4): Float32Array {
  const out = new Float32Array(pos.length);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) {
    v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(m);
    out[i] = v.x; out[i + 1] = v.y; out[i + 2] = v.z;
  }
  return out;
}

// Sample up to `n` points biased toward one end ('low'/'high') of the up-axis — i.e.
// the inner hair shell or the outer scalp, which are the surfaces that should touch.
function sampleShell(pos: Float32Array, n: number, axis: number, sign: 1 | -1, end: 'low' | 'high'): Float32Array {
  const count = pos.length / 3;
  // index + axis coordinate, then take the half closest to the contact surface.
  const idx = Array.from({ length: count }, (_, i) => i);
  const wantHigh = (end === 'high') === (sign > 0);
  idx.sort((a, b) => {
    const ca = pos[a * 3 + axis], cb = pos[b * 3 + axis];
    return wantHigh ? cb - ca : ca - cb;
  });
  const keep = Math.min(n, Math.ceil(count * 0.55));
  // stride-sample within the kept half so we cover the whole footprint, not a sliver.
  const stride = Math.max(1, Math.floor(keep / n));
  const picked: number[] = [];
  for (let i = 0; i < keep && picked.length < n; i += stride) picked.push(idx[i]);
  const out = new Float32Array(picked.length * 3);
  picked.forEach((p, k) => {
    out[k * 3] = pos[p * 3]; out[k * 3 + 1] = pos[p * 3 + 1]; out[k * 3 + 2] = pos[p * 3 + 2];
  });
  return out;
}

// Brute-force nearest neighbour from each src point to dst; returns matched pairs + RMS.
function correspondences(src: Float32Array, dst: Float32Array): { P: Float32Array; Q: Float32Array; rms: number } {
  const ns = src.length / 3, nd = dst.length / 3;
  const P = new Float32Array(ns * 3);
  const Q = new Float32Array(ns * 3);
  let sse = 0;
  for (let i = 0; i < ns; i++) {
    const sx = src[i * 3], sy = src[i * 3 + 1], sz = src[i * 3 + 2];
    let best = Infinity, bj = 0;
    for (let j = 0; j < nd; j++) {
      const dx = dst[j * 3] - sx, dy = dst[j * 3 + 1] - sy, dz = dst[j * 3 + 2] - sz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) { best = d; bj = j; }
    }
    P[i * 3] = sx; P[i * 3 + 1] = sy; P[i * 3 + 2] = sz;
    Q[i * 3] = dst[bj * 3]; Q[i * 3 + 1] = dst[bj * 3 + 1]; Q[i * 3 + 2] = dst[bj * 3 + 2];
    sse += best;
  }
  return { P, Q, rms: Math.sqrt(sse / Math.max(1, ns)) };
}

// Optimal rigid transform (rotation + translation) mapping P → Q, via Horn's quaternion.
function hornRigid(P: Float32Array, Q: Float32Array): THREE.Matrix4 {
  const n = P.length / 3;
  const cp = new THREE.Vector3(), cq = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    cp.x += P[i * 3]; cp.y += P[i * 3 + 1]; cp.z += P[i * 3 + 2];
    cq.x += Q[i * 3]; cq.y += Q[i * 3 + 1]; cq.z += Q[i * 3 + 2];
  }
  cp.multiplyScalar(1 / Math.max(1, n));
  cq.multiplyScalar(1 / Math.max(1, n));

  // cross-covariance M = Σ (p-cp)(q-cq)ᵀ
  let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
  for (let i = 0; i < n; i++) {
    const px = P[i * 3] - cp.x, py = P[i * 3 + 1] - cp.y, pz = P[i * 3 + 2] - cp.z;
    const qx = Q[i * 3] - cq.x, qy = Q[i * 3 + 1] - cq.y, qz = Q[i * 3 + 2] - cq.z;
    Sxx += px * qx; Sxy += px * qy; Sxz += px * qz;
    Syx += py * qx; Syy += py * qy; Syz += py * qz;
    Szx += pz * qx; Szy += pz * qy; Szz += pz * qz;
  }

  // Build the 4x4 symmetric matrix N (Horn 1987).
  const N = [
    Sxx + Syy + Szz, Syz - Szy,        Szx - Sxz,        Sxy - Syx,
    Syz - Szy,       Sxx - Syy - Szz,  Sxy + Syx,        Szx + Sxz,
    Szx - Sxz,       Sxy + Syx,        -Sxx + Syy - Szz, Syz + Szy,
    Sxy - Syx,       Szx + Sxz,        Syz + Szy,        -Sxx - Syy + Szz,
  ];
  const { values, vectors } = jacobiEigenSymmetric(N, 4);
  let mi = 0;
  for (let i = 1; i < 4; i++) if (values[i] > values[mi]) mi = i;
  // eigenvector column mi is the quaternion (w, x, y, z)
  const w = vectors[0 * 4 + mi], x = vectors[1 * 4 + mi], y = vectors[2 * 4 + mi], z = vectors[3 * 4 + mi];
  const q = new THREE.Quaternion(x, y, z, w).normalize();

  const R = new THREE.Matrix4().makeRotationFromQuaternion(q);
  const t = new THREE.Vector3().copy(cq).sub(applyLinear(R, cp));
  return similarityMatrix(R, 1, t);
}

// ── small linear-algebra utilities ───────────────────────────────────────────────

function basisMatrix(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): THREE.Matrix4 {
  // columns are a, b, c
  const m = new THREE.Matrix4();
  m.set(
    a.x, b.x, c.x, 0,
    a.y, b.y, c.y, 0,
    a.z, b.z, c.z, 0,
    0,   0,   0,   1,
  );
  return m;
}

function transpose4(m: THREE.Matrix4): THREE.Matrix4 {
  return m.clone().transpose();
}

function applyLinear(m: THREE.Matrix4, v: THREE.Vector3): THREE.Vector3 {
  const e = m.elements;
  return new THREE.Vector3(
    e[0] * v.x + e[4] * v.y + e[8] * v.z,
    e[1] * v.x + e[5] * v.y + e[9] * v.z,
    e[2] * v.x + e[6] * v.y + e[10] * v.z,
  );
}

// Ensure m is a proper rotation (det +1); flip last column if it's a reflection.
function enforceRotation(m: THREE.Matrix4) {
  if (m.determinant() < 0) {
    const e = m.elements;
    e[8] = -e[8]; e[9] = -e[9]; e[10] = -e[10];
  }
}

// Jacobi eigenvalue algorithm for a symmetric NxN matrix (row-major).
// Returns eigenvalues and eigenvectors (row-major, eigenvector k is column k).
export function jacobiEigenSymmetric(input: number[], N: number): { values: number[]; vectors: number[] } {
  const a = input.slice();
  const v = new Array(N * N).fill(0);
  for (let i = 0; i < N; i++) v[i * N + i] = 1;

  for (let sweep = 0; sweep < 100; sweep++) {
    // off-diagonal magnitude
    let off = 0;
    for (let p = 0; p < N; p++) for (let q = p + 1; q < N; q++) off += a[p * N + q] * a[p * N + q];
    if (off < 1e-20) break;

    for (let p = 0; p < N; p++) {
      for (let q = p + 1; q < N; q++) {
        const apq = a[p * N + q];
        if (Math.abs(apq) < 1e-18) continue;
        const app = a[p * N + p], aqq = a[q * N + q];
        const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
        const c = Math.cos(phi), s = Math.sin(phi);

        // rotate A
        for (let k = 0; k < N; k++) {
          const akp = a[k * N + p], akq = a[k * N + q];
          a[k * N + p] = c * akp - s * akq;
          a[k * N + q] = s * akp + c * akq;
        }
        for (let k = 0; k < N; k++) {
          const apk = a[p * N + k], aqk = a[q * N + k];
          a[p * N + k] = c * apk - s * aqk;
          a[q * N + k] = s * apk + c * aqk;
        }
        // accumulate V
        for (let k = 0; k < N; k++) {
          const vkp = v[k * N + p], vkq = v[k * N + q];
          v[k * N + p] = c * vkp - s * vkq;
          v[k * N + q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const values = new Array(N);
  for (let i = 0; i < N; i++) values[i] = a[i * N + i];
  return { values, vectors: v };
}
