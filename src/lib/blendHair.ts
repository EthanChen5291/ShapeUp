/** Resample a strand to n evenly-spaced points along its arc length. */
function resample(strand: Float32Array, n = 100): Float32Array {
  const pts = strand.length / 3;
  if (pts < 2) return strand;

  const cum = new Float32Array(pts);
  for (let i = 1; i < pts; i++) {
    const dx = strand[i*3]   - strand[(i-1)*3];
    const dy = strand[i*3+1] - strand[(i-1)*3+1];
    const dz = strand[i*3+2] - strand[(i-1)*3+2];
    cum[i] = cum[i-1] + Math.sqrt(dx*dx + dy*dy + dz*dz);
  }
  const total = cum[pts - 1];
  if (total < 1e-6) return strand;

  const out = new Float32Array(n * 3);
  for (let j = 0; j < n; j++) {
    const t = (j / (n - 1)) * total;
    let lo = 0, hi = pts - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= t) lo = mid; else hi = mid;
    }
    const a = cum[hi] > cum[lo] ? (t - cum[lo]) / (cum[hi] - cum[lo]) : 0;
    out[j*3]   = strand[lo*3]   + a * (strand[hi*3]   - strand[lo*3]);
    out[j*3+1] = strand[lo*3+1] + a * (strand[hi*3+1] - strand[lo*3+1]);
    out[j*3+2] = strand[lo*3+2] + a * (strand[hi*3+2] - strand[lo*3+2]);
  }
  return out;
}

/** Simple Lloyd's k-means on 3D root positions. */
function kmeans(strands: Float32Array[], k: number, maxIter = 20): number[] {
  const n = strands.length;
  const K = Math.min(k, n);
  if (K === 0 || n === 0) return [];

  // Init centroids from first K strands
  const cx = new Float32Array(K), cy = new Float32Array(K), cz = new Float32Array(K);
  for (let i = 0; i < K; i++) {
    cx[i] = strands[i][0]; cy[i] = strands[i][1]; cz[i] = strands[i][2];
  }

  const labels = new Int32Array(n);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const x = strands[i][0], y = strands[i][1], z = strands[i][2];
      let best = 0, bestD = Infinity;
      for (let c = 0; c < K; c++) {
        const dx = x - cx[c], dy = y - cy[c], dz = z - cz[c];
        const d = dx*dx + dy*dy + dz*dz;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (labels[i] !== best) { labels[i] = best; changed = true; }
    }
    if (!changed) break;

    const sx = new Float32Array(K), sy = new Float32Array(K), sz = new Float32Array(K);
    const cnt = new Int32Array(K);
    for (let i = 0; i < n; i++) {
      const c = labels[i];
      sx[c] += strands[i][0]; sy[c] += strands[i][1]; sz[c] += strands[i][2];
      cnt[c]++;
    }
    for (let c = 0; c < K; c++) {
      if (cnt[c] > 0) { cx[c] = sx[c]/cnt[c]; cy[c] = sy[c]/cnt[c]; cz[c] = sz[c]/cnt[c]; }
    }
  }
  return Array.from(labels);
}

/**
 * Blend two sets of hair strands using region-aware linear interpolation.
 * Matches the Python algorithm: cluster roots into k regions, resample to 100pts,
 * then lerp: result = (1-alpha)*strandA + alpha*strandB.
 */
export function blendStrands(
  strandsA: Float32Array[],
  strandsB: Float32Array[],
  alpha = 0.5,
  k = 5,
): Float32Array[] {
  if (strandsA.length === 0) return strandsB;
  if (strandsB.length === 0) return strandsA;
  const K = Math.min(k, strandsA.length, strandsB.length);
  if (K === 0) return strandsA;
  const labelsA = kmeans(strandsA, K);
  const labelsB = kmeans(strandsB, K);

  const regA: Float32Array[][] = Array.from({ length: K }, () => []);
  const regB: Float32Array[][] = Array.from({ length: K }, () => []);
  for (let i = 0; i < strandsA.length; i++) regA[labelsA[i]].push(strandsA[i]);
  for (let i = 0; i < strandsB.length; i++) regB[labelsB[i]].push(strandsB[i]);

  const blended: Float32Array[] = [];
  for (let r = 0; r < K; r++) {
    const ra = regA[r], rb = regB[r];
    if (!ra.length || !rb.length) continue;
    const n = Math.max(ra.length, rb.length);
    for (let i = 0; i < n; i++) {
      const sa = resample(ra[i % ra.length]);
      const sb = resample(rb[i % rb.length]);
      const out = new Float32Array(sa.length);
      for (let j = 0; j < sa.length; j++) out[j] = (1 - alpha) * sa[j] + alpha * sb[j];
      blended.push(out);
    }
  }
  return blended;
}

/**
 * Convert strands to a flat segments array for LineSegmentsGeometry.setPositions().
 * Each segment is [x1,y1,z1, x2,y2,z2].
 */
export function strandsToSegments(strands: Float32Array[]): Float32Array {
  let total = 0;
  for (const s of strands) total += s.length / 3 - 1;
  const out = new Float32Array(total * 6);
  let idx = 0;
  for (const s of strands) {
    const pts = s.length / 3;
    for (let i = 0; i < pts - 1; i++) {
      out[idx++] = s[i*3];   out[idx++] = s[i*3+1];   out[idx++] = s[i*3+2];
      out[idx++] = s[(i+1)*3]; out[idx++] = s[(i+1)*3+1]; out[idx++] = s[(i+1)*3+2];
    }
  }
  return out;
}
