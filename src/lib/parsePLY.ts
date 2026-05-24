import * as THREE from 'three';

export interface PLYResult {
  geometry: THREE.BufferGeometry;
  bbox: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
}

export async function parsePLY(url: string): Promise<THREE.BufferGeometry> {
  const { geometry } = await parsePLYWithBBox(url);
  return geometry;
}

// Maps PLY scalar type names to byte sizes.
const PLY_TYPE_SIZES: Record<string, number> = {
  float: 4, float32: 4, double: 8, float64: 8,
  char: 1, uchar: 1, short: 2, ushort: 2,
  int: 4, uint: 4, int8: 1, uint8: 1,
  int16: 2, uint16: 2, int32: 4, uint32: 4,
};

type PropDef = { name: string; type: string; size: number };
type ElementDef = { name: string; count: number; props: PropDef[]; stride: number };

function parseHeaderElements(header: string): ElementDef[] {
  const elements: ElementDef[] = [];
  let current: ElementDef | null = null;
  for (const line of header.split('\n')) {
    const t = line.trim();
    const em = t.match(/^element (\S+) (\d+)$/);
    if (em) {
      current = { name: em[1], count: parseInt(em[2]), props: [], stride: 0 };
      elements.push(current);
      continue;
    }
    const pm = t.match(/^property (\S+) (\S+)$/);
    if (pm && current) {
      const size = PLY_TYPE_SIZES[pm[1]] ?? 4;
      current.props.push({ name: pm[2], type: pm[1], size });
      current.stride += size;
    }
  }
  return elements;
}

function readScalar(view: DataView, off: number, type: string): number {
  switch (type) {
    case 'double': case 'float64': return view.getFloat64(off, true);
    case 'float':  case 'float32': return view.getFloat32(off, true);
    case 'int':    case 'int32':   return view.getInt32(off, true);
    case 'uint':   case 'uint32':  return view.getUint32(off, true);
    case 'short':  case 'int16':   return view.getInt16(off, true);
    case 'ushort': case 'uint16':  return view.getUint16(off, true);
    case 'char':   case 'int8':    return view.getInt8(off);
    case 'uchar':  case 'uint8':   return view.getUint8(off);
    default:                       return view.getFloat32(off, true);
  }
}

function findEndHeader(buf: ArrayBuffer): number {
  const bytes = new Uint8Array(buf);
  const marker = 'end_header\n';
  for (let i = 0; i < bytes.length - marker.length; i++) {
    let match = true;
    for (let j = 0; j < marker.length; j++) {
      if (bytes[i + j] !== marker.charCodeAt(j)) { match = false; break; }
    }
    if (match) return i + marker.length;
  }
  return 0;
}

/**
 * Parses a 3D Gaussian Splatting PLY file and returns the XYZ center of every
 * Nth gaussian (subsampled for performance). Only reads x, y, z — all other
 * properties (SH coefficients, opacity, scale, rotation) are skipped.
 *
 * The returned coordinates are in the PLY's internal coordinate space; callers
 * must apply the scene's rotation/scale/translation to convert to scene space.
 */
export async function parseGaussianXYZ(
  url: string,
  step = 20,
): Promise<{ x: number; y: number; z: number }[]> {
  const buf = await fetch(url).then(r => r.arrayBuffer());
  const dataStart = findEndHeader(buf);
  const header = new TextDecoder().decode(buf.slice(0, dataStart));
  const elements = parseHeaderElements(header);
  const vertexEl = elements.find(e => e.name === 'vertex');
  if (!vertexEl) return [];

  let xOff = -1, yOff = -1, zOff = -1;
  let xType = 'float', yType = 'float', zType = 'float';
  let runOff = 0;
  for (const p of vertexEl.props) {
    if (p.name === 'x') { xOff = runOff; xType = p.type; }
    else if (p.name === 'y') { yOff = runOff; yType = p.type; }
    else if (p.name === 'z') { zOff = runOff; zType = p.type; }
    runOff += p.size;
  }
  if (xOff < 0 || yOff < 0 || zOff < 0) return [];

  const stride = vertexEl.stride;
  const view = new DataView(buf, dataStart);
  const out: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < vertexEl.count; i += step) {
    const base = i * stride;
    out.push({
      x: readScalar(view, base + xOff, xType),
      y: readScalar(view, base + yOff, yType),
      z: readScalar(view, base + zOff, zType),
    });
  }
  return out;
}

export async function parsePLYWithBBox(url: string): Promise<PLYResult> {
  const buf = await fetch(url).then(r => r.arrayBuffer());
  const dataStart = findEndHeader(buf);
  const header = new TextDecoder().decode(buf.slice(0, dataStart));
  const elements = parseHeaderElements(header);

  const vertexEl = elements.find(e => e.name === 'vertex');
  const edgeEl   = elements.find(e => e.name === 'edge');
  if (!vertexEl) throw new Error(`No vertex element in PLY: ${url}`);

  // Locate x/y/z within the vertex stride
  let xOff = 0, yOff = 0, zOff = 0;
  let xType = 'float', yType = 'float', zType = 'float';
  let runOff = 0;
  for (const p of vertexEl.props) {
    if (p.name === 'x') { xOff = runOff; xType = p.type; }
    else if (p.name === 'y') { yOff = runOff; yType = p.type; }
    else if (p.name === 'z') { zOff = runOff; zType = p.type; }
    runOff += p.size;
  }

  // Locate vertex1/vertex2 within the edge stride (fallback to offsets 0/4)
  let v1Off = 0, v2Off = 4, v1Type = 'int', v2Type = 'int';
  if (edgeEl) {
    let eRunOff = 0;
    for (const p of edgeEl.props) {
      if (p.name === 'vertex1') { v1Off = eRunOff; v1Type = p.type; }
      else if (p.name === 'vertex2') { v2Off = eRunOff; v2Type = p.type; }
      eRunOff += p.size;
    }
  }

  const view = new DataView(buf, dataStart);
  let offset = 0;

  const vertexCount = vertexEl.count;
  const edgeCount   = edgeEl?.count ?? 0;
  const vertexStride = vertexEl.stride || 12;
  const edgeStride   = edgeEl?.stride || 8;

  const positions = new Float32Array(vertexCount * 3);
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const x = readScalar(view, offset + xOff, xType);
    const y = readScalar(view, offset + yOff, yType);
    const z = readScalar(view, offset + zOff, zType);
    offset += vertexStride;
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  let indices: Uint32Array;
  if (edgeCount > 0) {
    indices = new Uint32Array(edgeCount * 2);
    for (let i = 0; i < edgeCount; i++) {
      indices[i * 2]     = readScalar(view, offset + v1Off, v1Type);
      indices[i * 2 + 1] = readScalar(view, offset + v2Off, v2Type);
      offset += edgeStride;
    }
  } else {
    // No explicit edges: build implicit consecutive-pair edges.
    // Filter out inter-strand jumps (threshold chosen to be >> within-strand
    // spacing ~0.001 and << typical strand-to-strand jump ~0.09 in FLAME space).
    const MAX_EDGE_LEN_SQ = 0.02 * 0.02;
    const edgeBuf: number[] = [];
    for (let i = 0; i < vertexCount - 1; i++) {
      const ax = positions[i * 3], ay = positions[i * 3 + 1], az = positions[i * 3 + 2];
      const bx = positions[(i+1) * 3], by = positions[(i+1) * 3 + 1], bz = positions[(i+1) * 3 + 2];
      const d2 = (bx-ax)*(bx-ax) + (by-ay)*(by-ay) + (bz-az)*(bz-az);
      if (d2 <= MAX_EDGE_LEN_SQ) { edgeBuf.push(i, i + 1); }
    }
    indices = new Uint32Array(edgeBuf);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return { geometry, bbox: { minX, maxX, minY, maxY, minZ, maxZ } };
}
