// POST { imageDataUrl: string } → { jobId: string }
// GET  ?jobId=<id>              → single status check; on success uploads PLY+splat to S3

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import { getSignedDownloadUrl, uploadToS3 } from '@/lib/s3';

const FACELIFT_URL = process.env.FACELIFT_URL ?? '';
const NGROK_HEADERS = { 'ngrok-skip-browser-warning': 'true', 'User-Agent': 'shapeup', 'Accept': 'application/json' };

const SH_C0 = 0.28209479177387814;

// Maps PLY scalar type names → byte size.
const PLY_SIZES: Record<string, number> = {
  float: 4, float32: 4, double: 8, float64: 8,
  char: 1, uchar: 1, int8: 1, uint8: 1,
  short: 2, ushort: 2, int16: 2, uint16: 2,
  int: 4, uint: 4, int32: 4, uint32: 4,
};

function plyToSplat(plyBuf: Buffer): Buffer {
  const END = Buffer.from('end_header\n');
  const headerEnd = plyBuf.indexOf(END);
  if (headerEnd === -1) throw new Error('Invalid PLY: no end_header');
  const dataOffset = headerEnd + END.length;
  const header = plyBuf.subarray(0, headerEnd).toString('ascii');

  const vcountMatch = header.match(/element vertex (\d+)/);
  if (!vcountMatch) throw new Error('No vertex count in PLY');
  const vcount = parseInt(vcountMatch[1]);

  // Build property map: name → byte offset within one vertex record
  const propLines = [...header.matchAll(/^property (\S+) (\S+)$/gm)];
  const propOffset: Record<string, number> = {};
  let stride = 0;
  for (const [, type, name] of propLines) {
    propOffset[name] = stride;
    stride += PLY_SIZES[type] ?? 4;
  }

  const f = (i: number, name: string) =>
    plyBuf.readFloatLE(dataOffset + i * stride + propOffset[name]);

  // Decode all splats
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
  const q   = [
    new Float32Array(vcount),
    new Float32Array(vcount),
    new Float32Array(vcount),
    new Float32Array(vcount),
  ];

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

  // Sort by opacity descending (improves alpha blending quality)
  const order = Array.from({ length: vcount }, (_, i) => i).sort((a2, b2) => a[b2] - a[a2]);

  // Pack into .splat binary: 32 bytes/splat
  // [x y z f32×3] [sx sy sz f32×3] [r g b a u8×4] [q0..q3 u8×4]
  const out = Buffer.allocUnsafe(vcount * 32);
  for (let i = 0; i < vcount; i++) {
    const j = order[i];
    const off = i * 32;
    out.writeFloatLE(x[j],  off);
    out.writeFloatLE(y[j],  off + 4);
    out.writeFloatLE(z[j],  off + 8);
    out.writeFloatLE(sx[j], off + 12);
    out.writeFloatLE(sy[j], off + 16);
    out.writeFloatLE(sz[j], off + 20);
    out.writeUInt8(Math.round(r[j] * 255), off + 24);
    out.writeUInt8(Math.round(g[j] * 255), off + 25);
    out.writeUInt8(Math.round(b[j] * 255), off + 26);
    out.writeUInt8(Math.round(a[j] * 255), off + 27);
    out.writeUInt8(Math.min(255, Math.max(0, Math.round(q[0][j] * 128 + 128))), off + 28);
    out.writeUInt8(Math.min(255, Math.max(0, Math.round(q[1][j] * 128 + 128))), off + 29);
    out.writeUInt8(Math.min(255, Math.max(0, Math.round(q[2][j] * 128 + 128))), off + 30);
    out.writeUInt8(Math.min(255, Math.max(0, Math.round(q[3][j] * 128 + 128))), off + 31);
  }

  console.log(`[facelift] converted ${vcount} gaussians → ${out.length} bytes splat`);
  return out;
}

export async function POST(req: NextRequest) {
  if (!FACELIFT_URL) {
    console.error('[facelift] POST: FACELIFT_URL not configured');
    return NextResponse.json({ error: 'FACELIFT_URL not configured' }, { status: 503 });
  }

  // Credit gate: require Clerk auth and deduct 1 credit per facelift job
  let authSession: Awaited<ReturnType<typeof auth>> | null = null;
  try {
    authSession = await auth();
  } catch {
    return NextResponse.json({ error: 'Auth unavailable' }, { status: 401 });
  }
  const { userId, getToken } = authSession;
  if (!userId) {
    return NextResponse.json({ error: 'Sign in to generate haircuts' }, { status: 401 });
  }
  const convexToken = await getToken({ template: 'convex' });
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(convexToken!);
  try {
    await convex.mutation(api.users.deductCredit, {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes('No credits') ? 402 : 400;
    return NextResponse.json({ error: msg }, { status });
  }

  const { imageDataUrl, currentProfile } = await req.json() as { imageDataUrl?: string; currentProfile?: unknown };
  if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image')) {
    return NextResponse.json({ error: 'Invalid imageDataUrl' }, { status: 400 });
  }

  const base64 = imageDataUrl.split(',')[1];
  const buffer = Buffer.from(base64, 'base64');

  const blob = new Blob([buffer], { type: 'image/jpeg' });
  const form = new FormData();
  form.append('image', blob, 'face.jpg');
  if (currentProfile != null) {
    form.append('current_profile_json', JSON.stringify(currentProfile));
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${FACELIFT_URL}/process_image`, {
      method:  'POST',
      headers: { 'ngrok-skip-browser-warning': 'true' },
      body:    form,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[facelift] POST: network error reaching FaceLift server: ${msg}`);
    return NextResponse.json({ error: `Cannot reach FaceLift server: ${msg}` }, { status: 502 });
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    console.error(`[facelift] POST: server error ${upstream.status}: ${text}`);
    return NextResponse.json({ error: `FaceLift server error: ${text}` }, { status: 502 });
  }

  const data = await upstream.json();
  console.log(`[facelift] POST: job queued, jobId=${data.job_id}`);
  return NextResponse.json({ jobId: data.job_id });
}

// Single status check — client is responsible for polling.
export async function GET(req: NextRequest) {
  if (!FACELIFT_URL) {
    return NextResponse.json({ error: 'FACELIFT_URL not configured' }, { status: 503 });
  }

  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
  }

  let authSession: Awaited<ReturnType<typeof auth>> | null = null;
  try { authSession = await auth(); } catch { /* unauthenticated poll is fine */ }
  const userId = authSession?.userId ?? null;

  console.log(`[facelift] GET: checking status for jobId=${jobId}`);
  let statusRes: Response;
  try {
    statusRes = await fetch(`${FACELIFT_URL}/status/${jobId}`, { headers: NGROK_HEADERS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[facelift] GET: network error reaching FaceLift server: ${msg}`);
    return NextResponse.json({ error: `Cannot reach FaceLift server: ${msg}` }, { status: 502 });
  }
  if (!statusRes.ok) {
    const text = await statusRes.text().catch(() => '');
    console.error(`[facelift] GET: status endpoint returned ${statusRes.status}: ${text}`);
    return NextResponse.json({ error: `FaceLift server error: ${text}` }, { status: 502 });
  }

  const status = await statusRes.json();
  console.log(`[facelift] GET: jobId=${jobId} status=${status.status}`, status.error ? `error=${status.error}` : '');

  if (status.status === 'success') {
    console.log(`[facelift] GET: job succeeded, downloading from ${FACELIFT_URL}/download/${jobId}`);
    let dlRes: Response;
    try {
      dlRes = await fetch(`${FACELIFT_URL}/download/${jobId}/ply`, { headers: NGROK_HEADERS });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[facelift] GET: network error downloading PLY: ${msg}`);
      return NextResponse.json({ error: `Cannot reach FaceLift server: ${msg}` }, { status: 502 });
    }
    if (!dlRes.ok) {
      const text = await dlRes.text().catch(() => '');
      console.error(`[facelift] GET: download failed ${dlRes.status}: ${text}`);
      return NextResponse.json({ error: 'Download failed' }, { status: 502 });
    }
    const plyBuffer = Buffer.from(await dlRes.arrayBuffer());
    console.log(`[facelift] GET: downloaded PLY (${plyBuffer.length} bytes), converting to splat`);
    const splatBuffer = plyToSplat(plyBuffer);

    const plyKey   = `facelifts/${jobId}/output.ply`;
    const splatKey = `facelifts/${jobId}/output.splat`;
    await Promise.all([
      uploadToS3(plyKey,   plyBuffer,   'application/octet-stream'),
      uploadToS3(splatKey, splatBuffer, 'application/octet-stream'),
    ]);
    console.log(`[facelift] GET: uploaded to S3 — ply=${plyBuffer.length}B splat=${splatBuffer.length}B`);

    if (userId && authSession) {
      try {
        const convexToken = await authSession.getToken({ template: 'convex' });
        const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
        convex.setAuth(convexToken!);
        await convex.mutation(api.facelifts.recordResult, { userId, jobId, plyS3Key: plyKey, splatS3Key: splatKey });
        console.log(`[facelift] GET: recorded result in Convex for user=${userId}`);
      } catch (err) {
        console.error('[facelift] GET: failed to record in Convex (non-fatal):', err);
      }
    }

    const [plyUrl, splatUrl] = await Promise.all([
      getSignedDownloadUrl(plyKey),
      getSignedDownloadUrl(splatKey),
    ]);
    return NextResponse.json({ status: 'success', plyUrl, splatUrl });
  }

  if (status.status === 'error') {
    const errMsg = status.error || status.message || status.detail || JSON.stringify(status);
    console.error(`[facelift] GET: job failed —`, errMsg);
    return NextResponse.json({ status: 'error', error: errMsg || 'Unknown error' });
  }

  console.log(`[facelift] GET: job still running, status=${status.status ?? 'processing'}`);
  return NextResponse.json({ status: status.status ?? 'processing' });
}
