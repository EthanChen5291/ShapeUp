// GET /api/facelift/<jobId>/ply   → streams gaussians.ply
// GET /api/facelift/<jobId>/video → streams turntable.mp4

import { NextRequest, NextResponse } from 'next/server';
import { requireSignedIn } from '@/lib/serverAuth';
import { getFaceliftHeaders, isFaceliftConfigured, resolveFaceliftUrl } from '@/lib/facelift';

const JOB_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string; file: string }> }
) {
  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;

  if (!isFaceliftConfigured()) {
    return NextResponse.json({ error: 'FaceLift upstream not configured' }, { status: 503 });
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

  const faceliftUrl = await resolveFaceliftUrl();
  const upstream = await fetch(`${faceliftUrl}/download/${encodeURIComponent(jobId)}/${isPly ? 'ply' : 'video'}`, {
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
