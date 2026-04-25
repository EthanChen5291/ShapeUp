// GET /api/facelift/<jobId>/ply   → streams gaussians.ply
// GET /api/facelift/<jobId>/splat → downloads PLY, converts to .splat in-memory, returns binary
// GET /api/facelift/<jobId>/video → streams turntable.mp4

import { NextRequest, NextResponse } from 'next/server';
import { plyToSplat } from '@/lib/plyToSplat';

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
  const isSplat = file === 'splat';
  const isVideo = file === 'video';
  if (!isPly && !isSplat && !isVideo) {
    return NextResponse.json({ error: 'file must be "ply", "gaussians.ply", "splat", or "video"' }, { status: 400 });
  }

  const upstream = await fetch(`${FACELIFT_URL}/download/${jobId}/${isVideo ? 'video' : 'ply'}`, {
    headers: { 'ngrok-skip-browser-warning': '1', 'User-Agent': 'shapeup' },
  });

  if (!upstream.ok) {
    return NextResponse.json({ error: 'Download failed' }, { status: upstream.status });
  }

  if (isVideo) {
    const buffer = await upstream.arrayBuffer();
    return new NextResponse(buffer, {
      headers: { 'Content-Type': 'video/mp4', 'Content-Disposition': 'inline' },
    });
  }

  const plyArrayBuffer = await upstream.arrayBuffer();

  if (isSplat) {
    const splatBuffer = plyToSplat(Buffer.from(plyArrayBuffer));
    return new NextResponse(new Uint8Array(splatBuffer), {
      headers: {
        'Content-Type':        'application/octet-stream',
        'Content-Disposition': 'inline; filename="output.splat"',
        'Cache-Control':       'public, max-age=3600',
      },
    });
  }

  return new NextResponse(plyArrayBuffer, {
    headers: {
      'Content-Type':        'application/octet-stream',
      'Content-Disposition': 'attachment; filename="gaussians.ply"',
    },
  });
}
