// POST { imageDataUrl: string } → { jobId: string }
// GET  ?jobId=<id>              → single status check; on success returns splatPath URL

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';

const FACELIFT_URL = process.env.FACELIFT_URL ?? '';
const NGROK_HEADERS = { 'ngrok-skip-browser-warning': 'true', 'User-Agent': 'shapeup', 'Accept': 'application/json' };

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
    console.log(`[facelift] GET: job succeeded, jobId=${jobId}`);
    return NextResponse.json({
      status:    'success',
      plyPath:   `/api/facelift/${jobId}/ply`,
      splatPath: `/api/facelift/${jobId}/splat`,
    });
  }

  if (status.status === 'error') {
    const errMsg = status.error || status.message || status.detail || JSON.stringify(status);
    console.error(`[facelift] GET: job failed —`, errMsg);
    return NextResponse.json({ status: 'error', error: errMsg || 'Unknown error' });
  }

  console.log(`[facelift] GET: job still running, status=${status.status ?? 'processing'}`);
  return NextResponse.json({ status: status.status ?? 'processing' });
}
