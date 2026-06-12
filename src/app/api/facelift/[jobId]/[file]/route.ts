// GET /api/facelift/<jobId>/ply   → streams gaussians.ply
// GET /api/facelift/<jobId>/video → streams turntable.mp4

import { NextRequest, NextResponse } from 'next/server';
import { requireSignedIn } from '@/lib/serverAuth';

const FACELIFT_URL = process.env.FACELIFT_URL ?? '';
const FACELIFT_SHARED_SECRET = process.env.FACELIFT_SHARED_SECRET ?? '';
const JOB_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

function getFaceliftHeaders(): HeadersInit {
  return {
    'ngrok-skip-browser-warning': '1',
    'User-Agent': 'shapeup',
    ...(FACELIFT_SHARED_SECRET ? { 'X-ShapeUp-Facelift-Secret': FACELIFT_SHARED_SECRET } : {}),
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string; file: string }> }
) {
  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;

  if (!FACELIFT_URL) {
    return NextResponse.json({ error: 'FACELIFT_URL not configured' }, { status: 503 });
  }

  const { jobId, file } = await params;
  const isPly   = file === 'ply' || file === 'gaussians.ply';
  const isVideo = file === 'video';
  if (!isPly && !isVideo) {
    return NextResponse.json({ error: 'file must be "ply", "gaussians.ply", or "video"' }, { status: 400 });
  }
  if (!JOB_ID_PATTERN.test(jobId)) {
    return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 });
  }

  const upstream = await fetch(`${FACELIFT_URL}/download/${encodeURIComponent(jobId)}/${isPly ? 'ply' : 'video'}`, {
    headers: getFaceliftHeaders(),
  });

  if (!upstream.ok) {
    return NextResponse.json({ error: 'Download failed' }, { status: upstream.status });
  }

  const contentType = isPly ? 'application/octet-stream' : 'video/mp4';
  const disposition = isPly ? 'attachment; filename="gaussians.ply"' : 'inline';
  const buffer      = await upstream.arrayBuffer();

  return new NextResponse(buffer, {
    headers: {
      'Content-Type':        contentType,
      'Content-Disposition': disposition,
    },
  });
}
