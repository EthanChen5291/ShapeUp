/**
 * Parses a PLY file (ASCII or binary, float32 or float64 vertices, int32 edges)
 * into an array of strands, where each strand is a Float32Array of [x,y,z, x,y,z, ...].
 * Strand topology is reconstructed by tracing connected edge chains.
 */

function traceStrands(positions: Float32Array, edges: Int32Array, vertexCount: number): Float32Array[] {
  const adj: number[][] = Array.from({ length: vertexCount }, () => []);
  const edgeCount = edges.length / 2;
  for (let i = 0; i < edgeCount; i++) {
    const a = edges[i * 2], b = edges[i * 2 + 1];
    adj[a].push(b);
    adj[b].push(a);
  }

  const visited = new Uint8Array(vertexCount);
  const strands: Float32Array[] = [];

  for (let start = 0; start < vertexCount; start++) {
    if (visited[start] || adj[start].length !== 1) continue;

    const pts: number[] = [];
    let cur = start, prev = -1;
    while (cur !== -1) {
      visited[cur] = 1;
      pts.push(positions[cur * 3], positions[cur * 3 + 1], positions[cur * 3 + 2]);
      let next = -1;
      for (const n of adj[cur]) {
        if (n !== prev && !visited[n]) { next = n; break; }
      }
      prev = cur;
      cur = next;
    }
    if (pts.length >= 6) strands.push(new Float32Array(pts));
  }
  return strands;
}

export async function parsePLYStrands(source: string | ArrayBuffer): Promise<Float32Array[]> {
  const buf = typeof source === 'string'
    ? await fetch(source).then(r => { if (!r.ok) return new ArrayBuffer(0); return r.arrayBuffer(); })
    : source;
  if (buf.byteLength === 0) return [];

  const bytes = new Uint8Array(buf);
  const marker = 'end_header\n';
  let dataStart = 0;
  for (let i = 0; i <= bytes.length - marker.length; i++) {
    let match = true;
    for (let j = 0; j < marker.length; j++) {
      if (bytes[i + j] !== marker.charCodeAt(j)) { match = false; break; }
    }
    if (match) { dataStart = i + marker.length; break; }
  }

  const header = new TextDecoder().decode(buf.slice(0, dataStart));
  const isAscii = header.includes('format ascii');
  const vertexCount = parseInt(header.match(/element vertex (\d+)/)![1]);
  const edgeCount   = parseInt(header.match(/element edge (\d+)/)?.[1] ?? '0');

  const positions = new Float32Array(vertexCount * 3);
  const edges     = new Int32Array(edgeCount * 2);

  if (isAscii) {
    const text  = new TextDecoder().decode(buf.slice(dataStart));
    const lines = text.trim().split('\n');
    for (let i = 0; i < vertexCount; i++) {
      const p = lines[i].trim().split(/\s+/);
      positions[i * 3] = parseFloat(p[0]);
      positions[i * 3 + 1] = parseFloat(p[1]);
      positions[i * 3 + 2] = parseFloat(p[2]);
    }
    for (let i = 0; i < edgeCount; i++) {
      const p = lines[vertexCount + i].trim().split(/\s+/);
      edges[i * 2]     = parseInt(p[0]);
      edges[i * 2 + 1] = parseInt(p[1]);
    }
  } else {
    const isDouble = /property\s+(double|float64)\s+x/.test(header);
    const view = new DataView(buf, dataStart);
    let off = 0;
    for (let i = 0; i < vertexCount; i++) {
      if (isDouble) {
        positions[i * 3]     = view.getFloat64(off, true); off += 8;
        positions[i * 3 + 1] = view.getFloat64(off, true); off += 8;
        positions[i * 3 + 2] = view.getFloat64(off, true); off += 8;
      } else {
        positions[i * 3]     = view.getFloat32(off, true); off += 4;
        positions[i * 3 + 1] = view.getFloat32(off, true); off += 4;
        positions[i * 3 + 2] = view.getFloat32(off, true); off += 4;
      }
    }
    for (let i = 0; i < edgeCount; i++) {
      edges[i * 2]     = view.getInt32(off, true); off += 4;
      edges[i * 2 + 1] = view.getInt32(off, true); off += 4;
    }
  }

  return traceStrands(positions, edges, vertexCount);
}
