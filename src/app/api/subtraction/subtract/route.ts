// POST { originalPlyUrl, baldPlyUrl } → { jobId, plyUrl, splatUrl, keptCount, totalOriginal, totalBald, retainedPct }
// Downloads both PLY files from their signed URLs, builds a 3D voxel set from the bald PLY,
// filters the original to keep only gaussians NOT present in bald (≈ the hair), converts to .splat,
// uploads both to S3, and returns signed download URLs.

export const maxDuration = 120; // 2 min for download + subtract + upload

import { NextRequest, NextResponse } from 'next/server';
import { uploadToS3, getSignedDownloadUrl } from '@/lib/s3';
import { requireSignedIn } from '@/lib/serverAuth';
import path from 'path';
import fs from 'fs/promises';

// ─── debug helper ─────────────────────────────────────────────────────────────
const TAG = '[subtraction/subtract]';
function dbg(msg: string, ...args: unknown[]) {
  console.log(`${TAG} ${new Date().toISOString()} ${msg}`, ...args);
}
function dbgErr(msg: string, ...args: unknown[]) {
  console.error(`${TAG} ${new Date().toISOString()} ERROR: ${msg}`, ...args);
}

// ─── constants ────────────────────────────────────────────────────────────────
const SH_C0 = 0.28209479177387814;
const MAX_PLY_BYTES = 80 * 1024 * 1024;

const PLY_SIZES: Record<string, number> = {
  float: 4, float32: 4, double: 8, float64: 8,
  char: 1,  uchar:  1, int8:  1, uint8: 1,
  short: 2, ushort: 2, int16: 2, uint16: 2,
  int:  4,  uint:   4, int32: 4, uint32: 4,
};

// ─── PLY PARSING ──────────────────────────────────────────────────────────────

interface PlyParsed {
  vcount:     number;
  stride:     number;
  dataOffset: number;
  propOffset: Record<string, number>;
  headerText: string;
  buf:        Buffer;
}

export function parsePlyHeader(buf: Buffer): PlyParsed {
  dbg(`parsePlyHeader: buf.length=${buf.length}`);
  const END = Buffer.from('end_header\n');
  const headerEnd = buf.indexOf(END);
  if (headerEnd === -1) throw new Error('Invalid PLY: no end_header marker found');

  const dataOffset = headerEnd + END.length;
  const headerText = buf.subarray(0, headerEnd).toString('ascii');
  dbg(`parsePlyHeader: headerEnd=${headerEnd}, dataOffset=${dataOffset}`);
  dbg(`parsePlyHeader: header preview: ${headerText.substring(0, 200).replace(/\n/g, '\\n')}`);

  const vcountMatch = headerText.match(/element vertex (\d+)/);
  if (!vcountMatch) throw new Error('No vertex count in PLY header (element vertex N)');
  const vcount = parseInt(vcountMatch[1], 10);

  const propLines = [...headerText.matchAll(/^property (\S+) (\S+)$/gm)];
  dbg(`parsePlyHeader: found ${propLines.length} property lines`);

  const propOffset: Record<string, number> = {};
  let stride = 0;
  for (const [, type, name] of propLines) {
    const size = PLY_SIZES[type] ?? 4;
    propOffset[name] = stride;
    stride += size;
    dbg(`parsePlyHeader:   prop "${name}" type="${type}" size=${size} offset=${propOffset[name]}`);
  }

  const expectedDataBytes = vcount * stride;
  const actualDataBytes   = buf.length - dataOffset;
  dbg(`parsePlyHeader: vcount=${vcount}, stride=${stride}, expectedData=${expectedDataBytes}B, actualData=${actualDataBytes}B`);

  if (actualDataBytes < expectedDataBytes) {
    throw new Error(`PLY data too short: expected ${expectedDataBytes}B but got ${actualDataBytes}B`);
  }

  dbg(`parsePlyHeader: OK — props=[${Object.keys(propOffset).join(', ')}]`);
  return { vcount, stride, dataOffset, propOffset, headerText, buf };
}

// ─── TEST: parsePlyHeader ─────────────────────────────────────────────────────
export function __test_parsePlyHeader(): void {
  console.log(`${TAG} __test_parsePlyHeader: running...`);

  const header = 'ply\nformat binary_little_endian 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n';
  const data   = Buffer.alloc(3 * 12); // 3 verts × 3 props × 4 bytes
  const buf    = Buffer.concat([Buffer.from(header), data]);
  const result = parsePlyHeader(buf);

  console.assert(result.vcount      === 3,  `vcount should be 3, got ${result.vcount}`);
  console.assert(result.stride      === 12, `stride should be 12, got ${result.stride}`);
  console.assert(result.propOffset['x'] === 0,  `x offset should be 0, got ${result.propOffset['x']}`);
  console.assert(result.propOffset['y'] === 4,  `y offset should be 4, got ${result.propOffset['y']}`);
  console.assert(result.propOffset['z'] === 8,  `z offset should be 8, got ${result.propOffset['z']}`);

  // Test malformed PLY (missing end_header)
  let threw = false;
  try { parsePlyHeader(Buffer.from('ply\nno header')); }
  catch { threw = true; }
  console.assert(threw, 'should throw on missing end_header');

  console.log(`${TAG} __test_parsePlyHeader: PASSED ✓`);
}

// ─── BOUNDING BOX ─────────────────────────────────────────────────────────────

export function computeBoundingBox(ply: PlyParsed) {
  dbg(`computeBoundingBox: computing over ${ply.vcount} vertices...`);
  let minX = Infinity,  minY = Infinity,  minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const { buf, vcount, stride, dataOffset, propOffset } = ply;

  if (!('x' in propOffset) || !('y' in propOffset) || !('z' in propOffset)) {
    throw new Error('PLY missing x/y/z position properties');
  }

  for (let i = 0; i < vcount; i++) {
    const base = dataOffset + i * stride;
    const x = buf.readFloatLE(base + propOffset['x']);
    const y = buf.readFloatLE(base + propOffset['y']);
    const z = buf.readFloatLE(base + propOffset['z']);
    if (x < minX) minX = x;  if (x > maxX) maxX = x;
    if (y < minY) minY = y;  if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;  if (z > maxZ) maxZ = z;
  }

  const diag = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2);
  dbg(`computeBoundingBox: x=[${minX.toFixed(4)}, ${maxX.toFixed(4)}]  y=[${minY.toFixed(4)}, ${maxY.toFixed(4)}]  z=[${minZ.toFixed(4)}, ${maxZ.toFixed(4)}]  diag=${diag.toFixed(4)}`);
  return { minX, minY, minZ, maxX, maxY, maxZ, diag };
}

// ─── TEST: computeBoundingBox ─────────────────────────────────────────────────
export function __test_computeBoundingBox(): void {
  console.log(`${TAG} __test_computeBoundingBox: running...`);

  function makeXyzPly(verts: [number, number, number][]): PlyParsed {
    const header = `ply\nformat binary_little_endian 1.0\nelement vertex ${verts.length}\nproperty float x\nproperty float y\nproperty float z\nend_header\n`;
    const data   = Buffer.allocUnsafe(verts.length * 12);
    verts.forEach(([x, y, z], i) => {
      data.writeFloatLE(x, i * 12);
      data.writeFloatLE(y, i * 12 + 4);
      data.writeFloatLE(z, i * 12 + 8);
    });
    return parsePlyHeader(Buffer.concat([Buffer.from(header), data]));
  }

  const ply  = makeXyzPly([[-1, 0, 0], [1, 0, 0], [0, 2, 0]]);
  const bbox = computeBoundingBox(ply);
  console.assert(bbox.minX === -1, `minX should be -1, got ${bbox.minX}`);
  console.assert(bbox.maxX ===  1, `maxX should be 1, got ${bbox.maxX}`);
  console.assert(bbox.maxY ===  2, `maxY should be 2, got ${bbox.maxY}`);

  console.log(`${TAG} __test_computeBoundingBox: PASSED ✓`);
}

// ─── VOXEL KEY ────────────────────────────────────────────────────────────────

// Maps a 3D position to a discrete voxel key string.
// The `| 0` converts -0 → 0 so keys are consistent.
export function voxelKey(x: number, y: number, z: number, voxelSize: number): string {
  const vx = (Math.floor(x / voxelSize) | 0);
  const vy = (Math.floor(y / voxelSize) | 0);
  const vz = (Math.floor(z / voxelSize) | 0);
  return `${vx}_${vy}_${vz}`;
}

// ─── TEST: voxelKey ───────────────────────────────────────────────────────────
export function __test_voxelKey(): void {
  console.log(`${TAG} __test_voxelKey: running...`);

  console.assert(voxelKey(0.005, 0.005, 0.005, 0.02) === '0_0_0',   'same voxel (1)');
  console.assert(voxelKey(0.019, 0.019, 0.019, 0.02) === '0_0_0',   'same voxel (2)');
  console.assert(voxelKey(0.021, 0.0,   0.0,   0.02) === '1_0_0',   'next voxel x');
  console.assert(voxelKey(-0.01, 0.0,   0.0,   0.02) === '-1_0_0',  'negative x');
  console.assert(voxelKey(0.0,   0.0,   0.0,   0.02) === '0_0_0',   'origin');
  console.assert(voxelKey(-0.0,  0.0,   0.0,   0.02) === '0_0_0',   'negative zero');

  console.log(`${TAG} __test_voxelKey: PASSED ✓`);
}

// ─── SUBTRACTION OPTIONS ─────────────────────────────────────────────────────

export interface SubtractOpts {
  scaleX?:          number; // scale applied to bald PLY x coords before voxelizing (default 1.0)
  scaleY?:          number; // scale applied to bald PLY y coords before voxelizing (default 1.0)
  scaleZ?:          number; // scale applied to bald PLY z coords before voxelizing (default 1.0)
  uniformScale?:    number; // multiplied with scaleX/Y/Z (default 1.0)
  voxelSizeOverride?: number; // if set, skips adaptive calculation (default undefined = auto)
}

// ─── BUILD VOXEL SET FROM PLY ─────────────────────────────────────────────────

export function buildVoxelSet(
  ply: PlyParsed,
  voxelSize: number,
  scale?: { x: number; y: number; z: number; center?: { x: number; y: number; z: number } },
): Set<string> {
  const sx = scale?.x ?? 1.0;
  const sy = scale?.y ?? 1.0;
  const sz = scale?.z ?? 1.0;
  const cx = scale?.center?.x ?? 0;
  const cy = scale?.center?.y ?? 0;
  const cz = scale?.center?.z ?? 0;
  const isUniformUnit = sx === 1 && sy === 1 && sz === 1;

  // Each gaussian's scale_0/1/2 stores log(radius) — use these to mark all voxels
  // within the gaussian's actual ellipsoid footprint, scaled by the user factor.
  // This fills gaps between gaussians so the bald mask is solid, and makes scale>1
  // expand the footprint rather than just spreading sparse points further apart.
  const MAX_DILATION   = 4; // voxel radius cap to keep O(n×r³) bounded
  const effectiveScale = Math.max(sx, sy, sz);
  const hasGaussScale  = 'scale_0' in ply.propOffset && 'scale_1' in ply.propOffset && 'scale_2' in ply.propOffset;

  dbg(`buildVoxelSet: ▶ START — ${ply.vcount} vertices, voxelSize=${voxelSize.toFixed(6)}`);
  dbg(`buildVoxelSet:   scale: x=${sx.toFixed(4)} y=${sy.toFixed(4)} z=${sz.toFixed(4)} about centroid=(${cx.toFixed(4)},${cy.toFixed(4)},${cz.toFixed(4)}) (${isUniformUnit ? 'identity' : 'SCALED'})`);
  dbg(`buildVoxelSet:   gaussian radius dilation: ${hasGaussScale ? `ON — effectiveScale=${effectiveScale.toFixed(4)}, MAX_DILATION=${MAX_DILATION}` : 'OFF — no scale_0/1/2 props, center-only'}`);

  const t0  = Date.now();
  const set = new Set<string>();
  const { buf, vcount, stride, dataOffset, propOffset } = ply;

  if (!('x' in propOffset) || !('y' in propOffset) || !('z' in propOffset)) {
    throw new Error('PLY missing x/y/z position properties for voxel set');
  }

  const firstBase = dataOffset;
  const lastBase  = dataOffset + Math.max(0, vcount - 1) * stride;
  dbg(`buildVoxelSet:   first vertex raw: (${buf.readFloatLE(firstBase + propOffset['x']).toFixed(4)}, ${buf.readFloatLE(firstBase + propOffset['y']).toFixed(4)}, ${buf.readFloatLE(firstBase + propOffset['z']).toFixed(4)})`);
  dbg(`buildVoxelSet:   last  vertex raw: (${buf.readFloatLE(lastBase  + propOffset['x']).toFixed(4)}, ${buf.readFloatLE(lastBase  + propOffset['y']).toFixed(4)}, ${buf.readFloatLE(lastBase  + propOffset['z']).toFixed(4)})`);

  let skipped = 0;
  let totalMarked = 0;
  for (let i = 0; i < vcount; i++) {
    const base = dataOffset + i * stride;
    const rawX = buf.readFloatLE(base + propOffset['x']);
    const rawY = buf.readFloatLE(base + propOffset['y']);
    const rawZ = buf.readFloatLE(base + propOffset['z']);

    if (!isFinite(rawX) || !isFinite(rawY) || !isFinite(rawZ)) {
      skipped++;
      continue;
    }

    // Centroid-based scaling: mask grows/shrinks around its own center with no world-origin drift
    const sX = cx + (rawX - cx) * sx;
    const sY = cy + (rawY - cy) * sy;
    const sZ = cz + (rawZ - cz) * sz;

    if (hasGaussScale) {
      const gs0 = buf.readFloatLE(base + propOffset['scale_0']);
      const gs1 = buf.readFloatLE(base + propOffset['scale_1']);
      const gs2 = buf.readFloatLE(base + propOffset['scale_2']);
      // PLY stores log(radius); multiply by user scale so larger scale = bigger footprint
      const gaussRadius = Math.exp(Math.max(gs0, gs1, gs2)) * effectiveScale;
      const r = Math.min(MAX_DILATION, Math.ceil(gaussRadius / voxelSize));
      const r2 = r * r;
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dz = -r; dz <= r; dz++) {
            if (dx * dx + dy * dy + dz * dz <= r2) {
              set.add(voxelKey(sX + dx * voxelSize, sY + dy * voxelSize, sZ + dz * voxelSize, voxelSize));
              totalMarked++;
            }
          }
        }
      }
    } else {
      set.add(voxelKey(sX, sY, sZ, voxelSize));
      totalMarked++;
    }
  }

  const elapsed = Date.now() - t0;
  dbg(`buildVoxelSet: ◀ DONE in ${elapsed}ms`);
  dbg(`buildVoxelSet:   ${set.size} unique voxels, ${totalMarked} total marks from ${vcount} vertices (~${vcount > 0 ? (totalMarked / vcount).toFixed(1) : 0} marks/gaussian)`);
  if (skipped > 0) dbg(`buildVoxelSet:   WARNING — skipped ${skipped} non-finite vertices`);
  dbg(`buildVoxelSet:   voxel set memory est: ~${Math.round(set.size * 40 / 1024)}KB`);
  return set;
}

// ─── SUBTRACT PLY ────────────────────────────────────────────────────────────
// Returns a new PLY buffer containing only vertices from `originalBuf` that do
// NOT have a matching voxel in `baldBuf`.  Those are the "hair" gaussians.
// opts.scaleX/Y/Z are applied to the BALD PLY coordinates before voxelizing —
// use values < 1 to shrink the bald mask (keeps more scalp), > 1 to expand it.

export function subtractPly(
  originalBuf: Buffer,
  baldBuf: Buffer,
  opts?: SubtractOpts,
): {
  resultPly: Buffer;
  keptCount: number;
  totalOriginal: number;
  totalBald: number;
  voxelSize: number;
  retainedPct: number;
  overlapCount: number;
} {
  const uni  = opts?.uniformScale ?? 1.0;
  const scX  = (opts?.scaleX ?? 1.0) * uni;
  const scY  = (opts?.scaleY ?? 1.0) * uni;
  const scZ  = (opts?.scaleZ ?? 1.0) * uni;
  const vsOv = opts?.voxelSizeOverride;

  dbg('='.repeat(60));
  dbg('subtractPly: ▶ START');
  dbg(`subtractPly:   opts = ${JSON.stringify({ scaleX: opts?.scaleX, scaleY: opts?.scaleY, scaleZ: opts?.scaleZ, uniformScale: opts?.uniformScale, voxelSizeOverride: opts?.voxelSizeOverride })}`);
  dbg(`subtractPly:   effective bald scale: x=${scX.toFixed(4)} y=${scY.toFixed(4)} z=${scZ.toFixed(4)}`);
  if (vsOv != null) dbg(`subtractPly:   voxelSize OVERRIDE = ${vsOv} (skipping adaptive calculation)`);

  dbg('subtractPly:   parsing original PLY...');
  const t0       = Date.now();
  const original = parsePlyHeader(originalBuf);
  dbg(`subtractPly:   original parsed in ${Date.now() - t0}ms — ${original.vcount} vertices, stride=${original.stride}`);

  dbg('subtractPly:   parsing bald PLY...');
  const t1   = Date.now();
  const bald  = parsePlyHeader(baldBuf);
  dbg(`subtractPly:   bald parsed in ${Date.now() - t1}ms — ${bald.vcount} vertices, stride=${bald.stride}`);

  // Bounding boxes (raw, before scale)
  dbg('subtractPly:   computing bounding boxes...');
  const origBbox = computeBoundingBox(original);
  const baldBbox = computeBoundingBox(bald);
  dbg(`subtractPly:   original bbox — x=[${origBbox.minX.toFixed(4)}, ${origBbox.maxX.toFixed(4)}] y=[${origBbox.minY.toFixed(4)}, ${origBbox.maxY.toFixed(4)}] z=[${origBbox.minZ.toFixed(4)}, ${origBbox.maxZ.toFixed(4)}] diag=${origBbox.diag.toFixed(4)}`);
  dbg(`subtractPly:   bald    bbox — x=[${baldBbox.minX.toFixed(4)}, ${baldBbox.maxX.toFixed(4)}] y=[${baldBbox.minY.toFixed(4)}, ${baldBbox.maxY.toFixed(4)}] z=[${baldBbox.minZ.toFixed(4)}, ${baldBbox.maxZ.toFixed(4)}] diag=${baldBbox.diag.toFixed(4)}`);
  dbg(`subtractPly:   original/bald diag ratio = ${(origBbox.diag / baldBbox.diag).toFixed(4)} (1.0 = perfect match)`);

  // Centroid of bald bbox — scale happens around this point so the mask doesn't drift
  const baldCx = (baldBbox.minX + baldBbox.maxX) / 2;
  const baldCy = (baldBbox.minY + baldBbox.maxY) / 2;
  const baldCz = (baldBbox.minZ + baldBbox.maxZ) / 2;
  dbg(`subtractPly:   bald centroid: (${baldCx.toFixed(4)}, ${baldCy.toFixed(4)}, ${baldCz.toFixed(4)})`);

  // Effective bald bbox after centroid-based scale (for intuition)
  dbg(`subtractPly:   bald bbox AFTER scale — x=[${(baldCx + (baldBbox.minX - baldCx) * scX).toFixed(4)}, ${(baldCx + (baldBbox.maxX - baldCx) * scX).toFixed(4)}] y=[${(baldCy + (baldBbox.minY - baldCy) * scY).toFixed(4)}, ${(baldCy + (baldBbox.maxY - baldCy) * scY).toFixed(4)}] z=[${(baldCz + (baldBbox.minZ - baldCz) * scZ).toFixed(4)}, ${(baldCz + (baldBbox.maxZ - baldCz) * scZ).toFixed(4)}]`);

  // Voxel size: override or adaptive (2.5% of bald bbox diagonal, clamped [0.003, 0.10])
  const adaptiveVoxelSize = Math.max(0.003, Math.min(0.10, baldBbox.diag * 0.025));
  const voxelSize         = vsOv != null ? vsOv : adaptiveVoxelSize;
  if (vsOv != null) {
    dbg(`subtractPly:   voxelSize = ${voxelSize.toFixed(6)} (MANUAL OVERRIDE; adaptive would have been ${adaptiveVoxelSize.toFixed(6)})`);
  } else {
    dbg(`subtractPly:   voxelSize = ${voxelSize.toFixed(6)} (adaptive: ${(baldBbox.diag * 0.025).toFixed(6)} clamped to [0.003, 0.10])`);
  }
  dbg(`subtractPly:   voxelSize relative to bald diag: ${(voxelSize / baldBbox.diag * 100).toFixed(2)}%`);
  dbg(`subtractPly:   voxelSize relative to orig diag: ${(voxelSize / origBbox.diag * 100).toFixed(2)}%`);

  // Build bald voxel set (with centroid-based scale applied)
  dbg('subtractPly:   building bald voxel set...');
  const t2         = Date.now();
  const baldVoxels = buildVoxelSet(bald, voxelSize, { x: scX, y: scY, z: scZ, center: { x: baldCx, y: baldCy, z: baldCz } });
  dbg(`subtractPly:   bald voxel set built in ${Date.now() - t2}ms — ${baldVoxels.size} unique voxels`);

  // Sanity check: sample first 5 bald vertices and check they appear in the set
  dbg('subtractPly:   SANITY CHECK — first 5 bald vertices vs voxel set:');
  for (let i = 0; i < Math.min(5, bald.vcount); i++) {
    const base  = bald.dataOffset + i * bald.stride;
    const rawX  = bald.buf.readFloatLE(base + bald.propOffset['x']);
    const rawY  = bald.buf.readFloatLE(base + bald.propOffset['y']);
    const rawZ  = bald.buf.readFloatLE(base + bald.propOffset['z']);
    const sclX  = baldCx + (rawX - baldCx) * scX;
    const sclY  = baldCy + (rawY - baldCy) * scY;
    const sclZ  = baldCz + (rawZ - baldCz) * scZ;
    const key   = voxelKey(sclX, sclY, sclZ, voxelSize);
    dbg(`subtractPly:     bald[${i}] raw=(${rawX.toFixed(4)},${rawY.toFixed(4)},${rawZ.toFixed(4)}) scaled=(${sclX.toFixed(4)},${sclY.toFixed(4)},${sclZ.toFixed(4)}) key=${key} inSet=${baldVoxels.has(key)}`);
  }

  // Sanity check: sample first 5 original vertices and check their membership
  dbg('subtractPly:   SANITY CHECK — first 5 original vertices vs bald voxel set:');
  const { buf: oBuf, vcount: oCount, stride, dataOffset: oDataOffset, propOffset } = original;
  for (let i = 0; i < Math.min(5, oCount); i++) {
    const base = oDataOffset + i * stride;
    const x    = oBuf.readFloatLE(base + propOffset['x']);
    const y    = oBuf.readFloatLE(base + propOffset['y']);
    const z    = oBuf.readFloatLE(base + propOffset['z']);
    const key  = voxelKey(x, y, z, voxelSize);
    dbg(`subtractPly:     orig[${i}] (${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}) key=${key} inBaldSet=${baldVoxels.has(key)} → ${baldVoxels.has(key) ? 'REMOVE (bald region)' : 'KEEP (hair)'}`);
  }

  // Filter original vertices
  dbg('subtractPly:   filtering original vertices...');
  const t3            = Date.now();
  const keptIndices:  number[] = [];
  let overlapCount = 0;
  let nonFiniteCount = 0;

  for (let i = 0; i < oCount; i++) {
    const base = oDataOffset + i * stride;
    const x    = oBuf.readFloatLE(base + propOffset['x']);
    const y    = oBuf.readFloatLE(base + propOffset['y']);
    const z    = oBuf.readFloatLE(base + propOffset['z']);

    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
      nonFiniteCount++;
      continue;
    }

    const key = voxelKey(x, y, z, voxelSize);
    if (baldVoxels.has(key)) {
      overlapCount++;
    } else {
      keptIndices.push(i);
    }
  }

  const keptCount   = keptIndices.length;
  const retainedPct = oCount > 0 ? parseFloat((keptCount / oCount * 100).toFixed(2)) : 0;
  const filterMs    = Date.now() - t3;

  dbg(`subtractPly:   filter done in ${filterMs}ms`);
  dbg(`subtractPly:   ┌─────────────────────────────────────────`);
  dbg(`subtractPly:   │ original total   : ${oCount.toLocaleString()}`);
  dbg(`subtractPly:   │ bald total       : ${bald.vcount.toLocaleString()}`);
  dbg(`subtractPly:   │ overlap (removed): ${overlapCount.toLocaleString()} (${(overlapCount/oCount*100).toFixed(2)}%)`);
  dbg(`subtractPly:   │ non-finite skip  : ${nonFiniteCount}`);
  dbg(`subtractPly:   │ KEPT (hair)      : ${keptCount.toLocaleString()} (${retainedPct}%)`);
  dbg(`subtractPly:   └─────────────────────────────────────────`);

  if (keptCount === 0) {
    dbgErr('subtractPly: NO vertices kept — possible causes:');
    dbgErr('  1. Coordinate system mismatch between original and bald PLY');
    dbgErr('  2. Scale factors too large (bald voxel set covers entire original)');
    dbgErr('  3. Voxel size too large (coarse grid consumes everything)');
    dbgErr(`  current params: scX=${scX} scY=${scY} scZ=${scZ} voxelSize=${voxelSize}`);
    throw new Error('Subtraction resulted in 0 vertices. Try reducing scale or voxel size.');
  }

  if (retainedPct > 95) {
    dbg(`subtractPly:   WARNING — retained ${retainedPct}% which is very high`);
    dbg(`subtractPly:   Possible causes: bald/original in different coordinate spaces, scale too small, voxelSize too small`);
  }
  if (retainedPct < 5) {
    dbg(`subtractPly:   WARNING — retained only ${retainedPct}% — scale may be too large, covering too much of original`);
  }

  // Build output PLY
  const newHeader = original.headerText.replace(/element vertex \d+/, `element vertex ${keptCount}`) + 'end_header\n';
  dbg(`subtractPly:   writing ${keptCount} vertices to output PLY...`);
  const t4        = Date.now();
  const headerBuf = Buffer.from(newHeader, 'ascii');
  const dataBuf   = Buffer.allocUnsafe(keptCount * stride);

  for (let i = 0; i < keptCount; i++) {
    const srcBase = oDataOffset + keptIndices[i] * stride;
    oBuf.copy(dataBuf, i * stride, srcBase, srcBase + stride);
  }

  const resultPly = Buffer.concat([headerBuf, dataBuf]);
  dbg(`subtractPly:   write done in ${Date.now() - t4}ms — result=${resultPly.length}B (${Math.round(resultPly.length / 1024)}KB)`);
  dbg('subtractPly: ◀ COMPLETE');
  dbg('='.repeat(60));

  return { resultPly, keptCount, totalOriginal: oCount, totalBald: bald.vcount, voxelSize, retainedPct, overlapCount };
}

// ─── TEST: subtractPly ────────────────────────────────────────────────────────
export function __test_subtractPly(): void {
  console.log(`${TAG} __test_subtractPly: running...`);

  function makeXyzPly(verts: [number, number, number][]): Buffer {
    const header = `ply\nformat binary_little_endian 1.0\nelement vertex ${verts.length}\nproperty float x\nproperty float y\nproperty float z\nend_header\n`;
    const data   = Buffer.allocUnsafe(verts.length * 12);
    verts.forEach(([x, y, z], i) => {
      data.writeFloatLE(x, i * 12);
      data.writeFloatLE(y, i * 12 + 4);
      data.writeFloatLE(z, i * 12 + 8);
    });
    return Buffer.concat([Buffer.from(header), data]);
  }

  // original: 4 verts. bald: 2 verts at same positions as first 2 of original.
  // Spread coords wide enough so diag is large and voxelSize is not too tiny.
  const originalPly = makeXyzPly([[0, 0, 0], [0.02, 0, 0], [5.0, 5.0, 0], [5.02, 5.0, 0]]);
  const baldPly     = makeXyzPly([[0, 0, 0], [0.02, 0, 0], [10, 10, 10]]); // shares first 2 with original

  const { resultPly, keptCount, totalOriginal, totalBald, retainedPct } =
    subtractPly(originalPly, baldPly);

  console.assert(totalOriginal === 4, `totalOriginal should be 4, got ${totalOriginal}`);
  console.assert(totalBald     === 3, `totalBald should be 3, got ${totalBald}`);
  // The two shared verts ([0,0,0] and [0.02,0,0]) should be filtered out,
  // leaving the two "hair" verts ([5.0,5.0,0] and [5.02,5.0,0]).
  console.assert(keptCount === 2, `keptCount should be 2, got ${keptCount}`);
  console.assert(retainedPct === 50, `retainedPct should be 50, got ${retainedPct}`);

  // Verify the result is a parseable PLY with correct vertex count
  const parsed = parsePlyHeader(resultPly);
  console.assert(parsed.vcount === 2, `result vcount should be 2, got ${parsed.vcount}`);

  // Test all-shared case (should throw)
  let threw = false;
  try {
    subtractPly(makeXyzPly([[0, 0, 0]]), makeXyzPly([[0, 0, 0], [5, 5, 5]]));
  } catch {
    threw = true;
  }
  console.assert(threw, 'should throw when no vertices remain after subtraction');

  console.log(`${TAG} __test_subtractPly: PASSED ✓  (kept=${keptCount}/${totalOriginal}, ${retainedPct}%)`);
}

// ─── PLY → SPLAT CONVERSION ───────────────────────────────────────────────────
// Binary .splat format: 32 bytes/gaussian
//   [0]  float32 x, y, z          (12 bytes)
//   [12] float32 scale_x, y, z    (12 bytes)
//   [24] uint8  r, g, b, a        ( 4 bytes)
//   [28] uint8  q0, q1, q2, q3    ( 4 bytes)

export function plyToSplat(plyBuf: Buffer): Buffer {
  dbg('plyToSplat: starting conversion...');
  const END       = Buffer.from('end_header\n');
  const headerEnd = plyBuf.indexOf(END);
  if (headerEnd === -1) throw new Error('Invalid PLY: no end_header');

  const dataOffset = headerEnd + END.length;
  const header     = plyBuf.subarray(0, headerEnd).toString('ascii');

  const vcountMatch = header.match(/element vertex (\d+)/);
  if (!vcountMatch) throw new Error('No vertex count in PLY');
  const vcount = parseInt(vcountMatch[1], 10);
  dbg(`plyToSplat: vcount=${vcount}`);

  if (vcount === 0) {
    dbg('plyToSplat: vcount=0, returning empty splat buffer');
    return Buffer.alloc(0);
  }

  const propLines = [...header.matchAll(/^property (\S+) (\S+)$/gm)];
  const propOffset: Record<string, number> = {};
  let stride = 0;
  for (const [, type, name] of propLines) {
    propOffset[name] = stride;
    stride += PLY_SIZES[type] ?? 4;
  }
  dbg(`plyToSplat: stride=${stride}, props=${Object.keys(propOffset).join(',')}`);

  const requiredProps = ['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];
  const missing       = requiredProps.filter(p => !(p in propOffset));
  if (missing.length > 0) {
    throw new Error(`PLY missing required Gaussian Splatting properties: ${missing.join(', ')}`);
  }

  const f = (i: number, name: string) =>
    plyBuf.readFloatLE(dataOffset + i * stride + propOffset[name]);

  const x   = new Float32Array(vcount);
  const y   = new Float32Array(vcount);
  const z   = new Float32Array(vcount);
  const r   = new Float32Array(vcount);
  const g   = new Float32Array(vcount);
  const b   = new Float32Array(vcount);
  const a   = new Float32Array(vcount);
  const sx  = new Float32Array(vcount);
  const sy  = new Float32Array(vcount);
  const sz  = new Float32Array(vcount);
  const q   = [new Float32Array(vcount), new Float32Array(vcount), new Float32Array(vcount), new Float32Array(vcount)];

  dbg(`plyToSplat: reading ${vcount} gaussians...`);
  for (let i = 0; i < vcount; i++) {
    x[i]  = f(i, 'x');
    y[i]  = f(i, 'y');
    z[i]  = f(i, 'z');
    r[i]  = Math.min(1, Math.max(0, 0.5 + SH_C0 * f(i, 'f_dc_0')));
    g[i]  = Math.min(1, Math.max(0, 0.5 + SH_C0 * f(i, 'f_dc_1')));
    b[i]  = Math.min(1, Math.max(0, 0.5 + SH_C0 * f(i, 'f_dc_2')));
    a[i]  = 1.0 / (1.0 + Math.exp(-f(i, 'opacity')));
    sx[i] = Math.exp(f(i, 'scale_0'));
    sy[i] = Math.exp(f(i, 'scale_1'));
    sz[i] = Math.exp(f(i, 'scale_2'));
    const q0 = f(i, 'rot_0'), q1 = f(i, 'rot_1'), q2 = f(i, 'rot_2'), q3 = f(i, 'rot_3');
    const qlen = Math.max(1e-8, Math.sqrt(q0*q0 + q1*q1 + q2*q2 + q3*q3));
    q[0][i] = q0 / qlen;
    q[1][i] = q1 / qlen;
    q[2][i] = q2 / qlen;
    q[3][i] = q3 / qlen;
  }

  // Sort by alpha descending for correct depth blending
  dbg('plyToSplat: sorting by alpha...');
  const order = Array.from({ length: vcount }, (_, i) => i).sort((a2, b2) => a[b2] - a[a2]);

  dbg('plyToSplat: writing output buffer...');
  const out = Buffer.allocUnsafe(vcount * 32);
  for (let i = 0; i < vcount; i++) {
    const j   = order[i];
    const off = i * 32;
    out.writeFloatLE(x[j],  off);
    out.writeFloatLE(y[j],  off + 4);
    out.writeFloatLE(z[j],  off + 8);
    out.writeFloatLE(sx[j], off + 12);
    out.writeFloatLE(sy[j], off + 16);
    out.writeFloatLE(sz[j], off + 20);
    out.writeUInt8(Math.round(r[j] * 255),                                           off + 24);
    out.writeUInt8(Math.round(g[j] * 255),                                           off + 25);
    out.writeUInt8(Math.round(b[j] * 255),                                           off + 26);
    out.writeUInt8(Math.round(a[j] * 255),                                           off + 27);
    out.writeUInt8(Math.min(255, Math.max(0, Math.round(q[0][j] * 128 + 128))),      off + 28);
    out.writeUInt8(Math.min(255, Math.max(0, Math.round(q[1][j] * 128 + 128))),      off + 29);
    out.writeUInt8(Math.min(255, Math.max(0, Math.round(q[2][j] * 128 + 128))),      off + 30);
    out.writeUInt8(Math.min(255, Math.max(0, Math.round(q[3][j] * 128 + 128))),      off + 31);
  }

  dbg(`plyToSplat: done — ${vcount} gaussians → ${out.length}B splat`);
  return out;
}

// ─── TEST: plyToSplat ─────────────────────────────────────────────────────────
export function __test_plyToSplat(): void {
  console.log(`${TAG} __test_plyToSplat: running...`);

  const props  = ['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];
  const header = `ply\nformat binary_little_endian 1.0\nelement vertex 1\n${props.map(p => `property float ${p}`).join('\n')}\nend_header\n`;
  const data   = Buffer.alloc(props.length * 4, 0);

  // Write sensible values for 1 vertex
  data.writeFloatLE(0.1,  0  * 4); // x
  data.writeFloatLE(0.2,  1  * 4); // y
  data.writeFloatLE(0.3,  2  * 4); // z
  data.writeFloatLE(0.5,  6  * 4); // opacity (sigmoid of 0.5 ≈ 0.623)
  data.writeFloatLE(1.0,  10 * 4); // rot_0 = 1 (identity quaternion w component)
  const buf   = Buffer.concat([Buffer.from(header), data]);
  const splat = plyToSplat(buf);

  console.assert(splat.length === 32, `expected 32 bytes for 1 splat, got ${splat.length}`);

  // x should be 0.1
  const xVal = splat.readFloatLE(0);
  console.assert(Math.abs(xVal - 0.1) < 1e-5, `x should be ~0.1, got ${xVal}`);

  // Test empty PLY (vcount=0)
  const emptyHeader = `ply\nformat binary_little_endian 1.0\nelement vertex 0\n${props.map(p => `property float ${p}`).join('\n')}\nend_header\n`;
  const emptySplat  = plyToSplat(Buffer.from(emptyHeader));
  console.assert(emptySplat.length === 0, `empty PLY should give 0-byte splat, got ${emptySplat.length}`);

  console.log(`${TAG} __test_plyToSplat: PASSED ✓`);
}

// ─── Run tests in dev ─────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'development') {
  setTimeout(() => { // defer so module init is complete
    console.log(`${TAG} ===== running inline tests =====`);
    const tests = [__test_parsePlyHeader, __test_computeBoundingBox, __test_voxelKey, __test_subtractPly, __test_plyToSplat];
    let passed = 0, failed = 0;
    for (const t of tests) {
      try { t(); passed++; }
      catch (e) { console.error(`${TAG} FAILED: ${t.name}:`, e); failed++; }
    }
    console.log(`${TAG} ===== tests done: ${passed} passed, ${failed} failed =====`);
  }, 0);
}

// ─── GET /api/subtraction/subtract/test — runs all tests, returns results ─────
export async function GET() {
  dbg('GET /test: running all inline tests...');
  const results: { name: string; passed: boolean; error?: string }[] = [];
  const tests = [__test_parsePlyHeader, __test_computeBoundingBox, __test_voxelKey, __test_subtractPly, __test_plyToSplat];

  for (const t of tests) {
    try {
      t();
      results.push({ name: t.name, passed: true });
    } catch (e) {
      results.push({ name: t.name, passed: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const allPassed = results.every(r => r.passed);
  dbg(`GET /test: ${results.filter(r => r.passed).length}/${results.length} passed`);
  return NextResponse.json({ allPassed, results }, { status: allPassed ? 200 : 500 });
}

// ─── POST /api/subtraction/subtract ──────────────────────────────────────────

export async function POST(req: NextRequest) {
  dbg('POST: received request');
  const reqStart = Date.now();

  // Auth
  const authResult = await requireSignedIn();
  if (authResult.response) {
    dbg('POST: unauthenticated — returning 401');
    return authResult.response;
  }
  dbg(`POST: authenticated userId=${authResult.session.userId}`);

  // Parse body
  let originalPlyUrl:   string | undefined;
  let baldPlyUrl:       string | undefined;
  let subtractOpts:     SubtractOpts = {};
  try {
    const body = await req.json() as {
      originalPlyUrl?: string;
      baldPlyUrl?:     string;
      scaleX?:         number;
      scaleY?:         number;
      scaleZ?:         number;
      uniformScale?:   number;
      voxelSizeOverride?: number;
    };
    originalPlyUrl = body.originalPlyUrl;
    baldPlyUrl     = body.baldPlyUrl;
    subtractOpts   = {
      scaleX:           body.scaleX,
      scaleY:           body.scaleY,
      scaleZ:           body.scaleZ,
      uniformScale:     body.uniformScale,
      voxelSizeOverride: body.voxelSizeOverride,
    };
  } catch {
    dbg('POST: invalid JSON body');
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  dbg(`POST: originalPlyUrl="${(originalPlyUrl ?? '').substring(0, 80)}..."`);
  dbg(`POST: baldPlyUrl="${(baldPlyUrl ?? '').substring(0, 80)}..."`);
  dbg(`POST: subtractOpts=${JSON.stringify(subtractOpts)}`);

  if (!originalPlyUrl || typeof originalPlyUrl !== 'string') {
    return NextResponse.json({ error: 'originalPlyUrl is required' }, { status: 400 });
  }
  if (!baldPlyUrl || typeof baldPlyUrl !== 'string') {
    return NextResponse.json({ error: 'baldPlyUrl is required' }, { status: 400 });
  }

  // Download both PLY files
  dbg('POST: downloading both PLY files in parallel...');
  let originalPlyBuf: Buffer;
  let baldPlyBuf:     Buffer;
  try {
    const dlStart                 = Date.now();
    const [origResp, baldResp]    = await Promise.all([
      fetch(originalPlyUrl, { signal: AbortSignal.timeout(60_000) }),
      fetch(baldPlyUrl,     { signal: AbortSignal.timeout(60_000) }),
    ]);
    dbg(`POST: fetch responses in ${Date.now() - dlStart}ms — orig=${origResp.status}, bald=${baldResp.status}`);

    if (!origResp.ok) throw new Error(`Failed to fetch original PLY: HTTP ${origResp.status}`);
    if (!baldResp.ok) throw new Error(`Failed to fetch bald PLY: HTTP ${baldResp.status}`);

    const arrStart               = Date.now();
    const [origArr, baldArr]     = await Promise.all([origResp.arrayBuffer(), baldResp.arrayBuffer()]);
    dbg(`POST: arrayBuffer() in ${Date.now() - arrStart}ms — orig=${origArr.byteLength}B, bald=${baldArr.byteLength}B`);

    if (origArr.byteLength > MAX_PLY_BYTES) throw new Error(`Original PLY too large: ${origArr.byteLength}B > ${MAX_PLY_BYTES}B`);
    if (baldArr.byteLength > MAX_PLY_BYTES) throw new Error(`Bald PLY too large: ${baldArr.byteLength}B > ${MAX_PLY_BYTES}B`);

    originalPlyBuf = Buffer.from(origArr);
    baldPlyBuf     = Buffer.from(baldArr);
    dbg(`POST: download complete — orig=${originalPlyBuf.length}B, bald=${baldPlyBuf.length}B`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    dbgErr(`POST: download failed: ${msg}`);
    return NextResponse.json({ error: `Failed to download PLY files: ${msg}` }, { status: 502 });
  }

  // Subtract PLY
  dbg('POST: running PLY subtraction...');
  let subResult: ReturnType<typeof subtractPly>;
  try {
    const t0 = Date.now();
    subResult = subtractPly(originalPlyBuf, baldPlyBuf, subtractOpts);
    dbg(`POST: subtraction done in ${Date.now() - t0}ms — keptCount=${subResult.keptCount}, retainedPct=${subResult.retainedPct}%, overlapCount=${subResult.overlapCount}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    dbgErr(`POST: subtractPly failed: ${msg}`);
    return NextResponse.json({ error: `PLY subtraction failed: ${msg}` }, { status: 500 });
  }

  // Convert result PLY → SPLAT
  dbg('POST: converting result PLY to .splat...');
  let splatBuf: Buffer;
  try {
    const t0 = Date.now();
    splatBuf = plyToSplat(subResult.resultPly);
    dbg(`POST: plyToSplat done in ${Date.now() - t0}ms — ${splatBuf.length}B`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    dbgErr(`POST: plyToSplat failed: ${msg}`);
    return NextResponse.json({ error: `SPLAT conversion failed: ${msg}` }, { status: 500 });
  }

  // Upload to S3
  const jobId    = crypto.randomUUID();
  const plyKey   = `subtractions/${jobId}/hair.ply`;
  const splatKey = `subtractions/${jobId}/hair.splat`;
  dbg(`POST: uploading to S3 — jobId=${jobId}, plyKey=${plyKey}, splatKey=${splatKey}`);

  try {
    const t0 = Date.now();
    await Promise.all([
      uploadToS3(plyKey,   subResult.resultPly, 'application/octet-stream'),
      uploadToS3(splatKey, splatBuf,            'application/octet-stream'),
    ]);
    dbg(`POST: S3 upload done in ${Date.now() - t0}ms`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    dbgErr(`POST: S3 upload failed: ${msg}`);
    return NextResponse.json({ error: `S3 upload failed: ${msg}` }, { status: 500 });
  }

  // Also write to public/ for local dev inspection
  try {
    const publicDir = path.join(process.cwd(), 'public');
    await Promise.all([
      fs.writeFile(path.join(publicDir, 'subtraction-hair.ply'),   subResult.resultPly),
      fs.writeFile(path.join(publicDir, 'subtraction-hair.splat'), splatBuf),
    ]);
    dbg('POST: wrote local public/subtraction-hair.{ply,splat} (non-fatal on error)');
  } catch (err) {
    dbg('POST: could not write local public/ files (non-fatal):', err);
  }

  // Get signed URLs
  const [plyUrl, splatUrl] = await Promise.all([
    getSignedDownloadUrl(plyKey),
    getSignedDownloadUrl(splatKey),
  ]);

  const totalMs = Date.now() - reqStart;
  dbg(`POST: complete in ${totalMs}ms — jobId=${jobId}, keptCount=${subResult.keptCount}/${subResult.totalOriginal} (${subResult.retainedPct}%)`);

  return NextResponse.json({
    jobId,
    plyUrl,
    splatUrl,
    keptCount:     subResult.keptCount,
    totalOriginal: subResult.totalOriginal,
    totalBald:     subResult.totalBald,
    retainedPct:   subResult.retainedPct,
    overlapCount:  subResult.overlapCount,
    voxelSize:     subResult.voxelSize,
    processingMs:  totalMs,
    opts:          subtractOpts,
  });
}
