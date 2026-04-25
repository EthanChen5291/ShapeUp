// GET /api/facelift/<jobId>/ply   → streams gaussians.ply
// GET /api/facelift/<jobId>/video → streams turntable.mp4

import { NextRequest, NextResponse } from 'next/server';

const FACELIFT_URL = process.env.FACELIFT_URL ?? '';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string; file: string }> }
) {
  if (!FACELIFT_URL) {
    return NextResponse.json({ error: 'FACELIFT_URL not configured' }, { status: 503 });
  }

  const { jobId, file } = await params;
  const isPly   = file === 'ply' || file === 'gaussians.ply';
  const isVideo = file === 'video';
  if (!isPly && !isVideo) {
    return NextResponse.json({ error: 'file must be "ply", "gaussians.ply", or "video"' }, { status: 400 });
  }

  const upstream = await fetch(`${FACELIFT_URL}/download/${jobId}/${isPly ? 'ply' : 'video'}`, {
    headers: { 'ngrok-skip-browser-warning': '1', 'User-Agent': 'shapeup' },
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
