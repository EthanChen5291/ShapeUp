'use client';

// Browser-side PLY parsing and splat/export utilities.
// Uses DataView (not Node.js Buffer) — all browser-safe.

export interface GaussianData {
  count:      number;
  positions:  Float32Array; // [x0,y0,z0, x1,y1,z1, ...] length = count*3
  rawData:    Uint8Array;   // raw binary for all gaussians, length = count*stride
  stride:     number;
  headerText: string;       // PLY header text WITHOUT the "end_header\n" line
  propOffset: Record<string, number>;
}

// Property byte sizes by PLY type name
const PROP_SIZE: Record<string, number> = {
  float: 4, float32: 4,
  double: 8, float64: 8,
  char: 1, int8: 1,
  uchar: 1, uint8: 1,
  short: 2, int16: 2,
  ushort: 2, uint16: 2,
  int: 4, int32: 4,
  uint: 4, uint32: 4,
};

export function parsePly(buffer: ArrayBuffer): GaussianData {
  console.log(`[parsePly] buffer byteLength=${buffer.byteLength}`);
  const bytes = new Uint8Array(buffer);

  // Peek first 16 bytes to detect if this is actually a .splat binary (no text header)
  const firstBytes = Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const firstText = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 20));
  console.log(`[parsePly] first 16 bytes hex: ${firstBytes}`);
  console.log(`[parsePly] first 20 chars text: ${JSON.stringify(firstText)}`);

  // Find "end_header\n" byte sequence
  const END_HEADER = 'end_header\n';
  const endHeaderBytes = new TextEncoder().encode(END_HEADER);
  let dataOffset = -1;
  outer: for (let i = 0; i <= bytes.length - endHeaderBytes.length; i++) {
    for (let j = 0; j < endHeaderBytes.length; j++) {
      if (bytes[i + j] !== endHeaderBytes[j]) continue outer;
    }
    dataOffset = i + endHeaderBytes.length;
    break;
  }
  if (dataOffset === -1) {
    console.error(`[parsePly] end_header not found — buffer may be .splat not .ply. byteLength=${buffer.byteLength}, byteLength%32=${buffer.byteLength % 32}`);
    throw new Error('parsePly: end_header not found');
  }
  console.log(`[parsePly] end_header found at offset=${dataOffset}`);

  const headerText = new TextDecoder().decode(bytes.slice(0, dataOffset - endHeaderBytes.length));
  console.log(`[parsePly] header:\n${headerText}`);

  // Parse header
  let count = 0;
  const propOffset: Record<string, number> = {};
  let currentStride = 0;
  let inVertexElement = false;

  for (const line of headerText.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'element' && parts[1] === 'vertex') {
      count = parseInt(parts[2], 10);
      inVertexElement = true;
    } else if (parts[0] === 'element' && parts[1] !== 'vertex') {
      inVertexElement = false;
    } else if (parts[0] === 'property' && inVertexElement) {
      const typeName = parts[1];
      const propName = parts[2];
      const sz = PROP_SIZE[typeName];
      if (sz === undefined) throw new Error(`parsePly: unknown property type "${typeName}"`);
      propOffset[propName] = currentStride;
      currentStride += sz;
    }
  }

  const stride = currentStride;
  console.log(`[parsePly] parsed: count=${count}, stride=${stride}, dataOffset=${dataOffset}`);
  console.log(`[parsePly] propOffsets:`, propOffset);
  console.log(`[parsePly] expected data bytes=${count * stride}, remaining bytes=${buffer.byteLength - dataOffset}`);

  if (count === 0) console.warn(`[parsePly] WARNING: count=0 — PLY has no vertices!`);
  if (count * stride > buffer.byteLength - dataOffset) {
    console.error(`[parsePly] OVERFLOW: need ${count * stride} bytes but only ${buffer.byteLength - dataOffset} available`);
  }

  const rawData = new Uint8Array(buffer, dataOffset, count * stride);

  // Build Float32Array of positions using DataView
  const positions = new Float32Array(count * 3);
  const view = new DataView(buffer, dataOffset, count * stride);
  const xOff = propOffset['x'] ?? 0;
  const yOff = propOffset['y'] ?? 4;
  const zOff = propOffset['z'] ?? 8;

  for (let i = 0; i < count; i++) {
    const base = i * stride;
    positions[i * 3 + 0] = view.getFloat32(base + xOff, true);
    positions[i * 3 + 1] = view.getFloat32(base + yOff, true);
    positions[i * 3 + 2] = view.getFloat32(base + zOff, true);
  }

  if (count > 0) {
    console.log(`[parsePly] first gaussian pos: x=${positions[0].toFixed(4)}, y=${positions[1].toFixed(4)}, z=${positions[2].toFixed(4)}`);
  }

  return { count, positions, rawData, stride, headerText, propOffset };
}

const SH_C0 = 0.28209479177387814;

// Clamp to [0, 255]
function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

// Convert scale log-scale to actual scale (exp)
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function buildSplatBlob(g: GaussianData, deleted: Set<number>): Blob {
  const { count, rawData, stride, propOffset } = g;

  // Indices of surviving gaussians
  const surviving: number[] = [];
  for (let i = 0; i < count; i++) {
    if (!deleted.has(i)) surviving.push(i);
  }

  const n = surviving.length;
  console.log(`[buildSplatBlob] count=${count}, deleted=${deleted.size}, surviving=${n}`);
  console.log(`[buildSplatBlob] stride=${stride}, rawData.byteLength=${rawData.byteLength}, rawData.byteOffset=${rawData.byteOffset}`);
  console.log(`[buildSplatBlob] propOffset:`, propOffset);

  // 32 bytes per splat: x f32, y f32, z f32, sx f32, sy f32, sz f32, r u8, g u8, b u8, a u8, q0 u8, q1 u8, q2 u8, q3 u8
  const SPLAT_STRIDE = 32;
  const out = new Uint8Array(n * SPLAT_STRIDE);
  console.log(`[buildSplatBlob] output buffer: ${out.byteLength} bytes (n=${n} × ${SPLAT_STRIDE}), divisible by 32: ${out.byteLength % 32 === 0}`);
  const outView = new DataView(out.buffer);

  // Precompute alphas for sorting
  const rawView = new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength);

  const opacityOff = propOffset['opacity'] ?? -1;
  const f_dc_0Off  = propOffset['f_dc_0']  ?? -1;
  const f_dc_1Off  = propOffset['f_dc_1']  ?? -1;
  const f_dc_2Off  = propOffset['f_dc_2']  ?? -1;
  const scale_0Off = propOffset['scale_0'] ?? -1;
  const scale_1Off = propOffset['scale_1'] ?? -1;
  const scale_2Off = propOffset['scale_2'] ?? -1;
  const rot_0Off   = propOffset['rot_0']   ?? -1;
  const rot_1Off   = propOffset['rot_1']   ?? -1;
  const rot_2Off   = propOffset['rot_2']   ?? -1;
  const rot_3Off   = propOffset['rot_3']   ?? -1;
  const xOff       = propOffset['x']       ?? 0;
  const yOff       = propOffset['y']       ?? 4;
  const zOff       = propOffset['z']       ?? 8;

  // Sort surviving gaussians by alpha descending — O(n log n)
  const sortedSurviving = surviving
    .map(idx => ({
      idx,
      alpha: opacityOff >= 0 ? sigmoid(rawView.getFloat32(idx * stride + opacityOff, true)) : 1,
    }))
    .sort((a, b) => b.alpha - a.alpha)
    .map(e => e.idx);

  for (let i = 0; i < n; i++) {
    const idx = sortedSurviving[i];
    const base = idx * stride;
    const outBase = i * SPLAT_STRIDE;

    const x  = rawView.getFloat32(base + xOff, true);
    const y  = rawView.getFloat32(base + yOff, true);
    const z  = rawView.getFloat32(base + zOff, true);

    const sx = scale_0Off >= 0 ? Math.exp(rawView.getFloat32(base + scale_0Off, true)) : 0.01;
    const sy = scale_1Off >= 0 ? Math.exp(rawView.getFloat32(base + scale_1Off, true)) : 0.01;
    const sz = scale_2Off >= 0 ? Math.exp(rawView.getFloat32(base + scale_2Off, true)) : 0.01;

    const dcR = f_dc_0Off >= 0 ? rawView.getFloat32(base + f_dc_0Off, true) : 0;
    const dcG = f_dc_1Off >= 0 ? rawView.getFloat32(base + f_dc_1Off, true) : 0;
    const dcB = f_dc_2Off >= 0 ? rawView.getFloat32(base + f_dc_2Off, true) : 0;

    const r = clamp255((0.5 + SH_C0 * dcR) * 255);
    const gv = clamp255((0.5 + SH_C0 * dcG) * 255);
    const b = clamp255((0.5 + SH_C0 * dcB) * 255);

    const opacity = opacityOff >= 0 ? rawView.getFloat32(base + opacityOff, true) : 0;
    const a = clamp255(sigmoid(opacity) * 255);

    // Quaternion
    const q0 = rot_0Off >= 0 ? rawView.getFloat32(base + rot_0Off, true) : 1;
    const q1 = rot_1Off >= 0 ? rawView.getFloat32(base + rot_1Off, true) : 0;
    const q2 = rot_2Off >= 0 ? rawView.getFloat32(base + rot_2Off, true) : 0;
    const q3 = rot_3Off >= 0 ? rawView.getFloat32(base + rot_3Off, true) : 0;
    const qLen = Math.sqrt(q0*q0 + q1*q1 + q2*q2 + q3*q3) || 1;

    outView.setFloat32(outBase + 0,  x,  true);
    outView.setFloat32(outBase + 4,  y,  true);
    outView.setFloat32(outBase + 8,  z,  true);
    outView.setFloat32(outBase + 12, sx, true);
    outView.setFloat32(outBase + 16, sy, true);
    outView.setFloat32(outBase + 20, sz, true);
    out[outBase + 24] = r;
    out[outBase + 25] = gv;
    out[outBase + 26] = b;
    out[outBase + 27] = a;
    out[outBase + 28] = clamp255((q0 / qLen) * 128 + 128);
    out[outBase + 29] = clamp255((q1 / qLen) * 128 + 128);
    out[outBase + 30] = clamp255((q2 / qLen) * 128 + 128);
    out[outBase + 31] = clamp255((q3 / qLen) * 128 + 128);

    if (i === 0) {
      console.log(`[buildSplatBlob] first splat out: x=${outView.getFloat32(0,true).toFixed(4)}, y=${outView.getFloat32(4,true).toFixed(4)}, z=${outView.getFloat32(8,true).toFixed(4)}, sx=${outView.getFloat32(12,true).toFixed(6)}, r=${out[24]}, g=${out[25]}, b=${out[26]}, a=${out[27]}, q0b=${out[28]}, q1b=${out[29]}, q2b=${out[30]}, q3b=${out[31]}`);
    }
  }

  const blob = new Blob([out], { type: 'application/octet-stream' });
  console.log(`[buildSplatBlob] blob size=${blob.size}, type=${blob.type}`);
  return blob;
}

export function buildPlyBlob(g: GaussianData, deleted: Set<number>): Blob {
  const { count, rawData, stride, headerText } = g;

  const remaining = count - deleted.size;

  // Patch vertex count in header
  const patchedHeader = headerText.replace(
    /element vertex \d+/,
    `element vertex ${remaining}`,
  );
  const fullHeader = patchedHeader + 'end_header\n';
  const headerBytes = new TextEncoder().encode(fullHeader);

  // Copy non-deleted gaussian raw bytes
  const dataBytes = new Uint8Array(remaining * stride);
  let writeIdx = 0;
  for (let i = 0; i < count; i++) {
    if (deleted.has(i)) continue;
    dataBytes.set(rawData.subarray(i * stride, i * stride + stride), writeIdx * stride);
    writeIdx++;
  }

  return new Blob([headerBytes, dataBytes], { type: 'application/octet-stream' });
}

export function projectToScreen(
  positions: Float32Array,
  mvpElements: ArrayLike<number>,
  width: number,
  height: number,
): Float32Array {
  // mvpElements is column-major 4x4 (THREE.Matrix4.elements)
  const m = mvpElements;
  const count = positions.length / 3;
  const screenPos = new Float32Array(count * 2);

  for (let i = 0; i < count; i++) {
    const px = positions[i * 3 + 0];
    const py = positions[i * 3 + 1];
    const pz = positions[i * 3 + 2];

    // Column-major multiply: clipPos = MVP * [px, py, pz, 1]
    const clipX = m[0]*px + m[4]*py + m[8]*pz  + m[12];
    const clipY = m[1]*px + m[5]*py + m[9]*pz  + m[13];
    const clipW = m[3]*px + m[7]*py + m[11]*pz + m[15];

    if (clipW <= 0) {
      // Behind camera
      screenPos[i * 2 + 0] = -99999;
      screenPos[i * 2 + 1] = -99999;
      continue;
    }

    const ndcX = clipX / clipW;
    const ndcY = clipY / clipW;

    screenPos[i * 2 + 0] = (ndcX + 1) / 2 * width;
    screenPos[i * 2 + 1] = (-ndcY + 1) / 2 * height;
  }

  return screenPos;
}
