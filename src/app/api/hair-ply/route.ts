import { NextRequest, NextResponse } from 'next/server';

const HAIR_PLY_URL = process.env.HAIR_PLY_URL ?? '';

export async function GET(req: NextRequest) {
  if (!HAIR_PLY_URL) {
    return NextResponse.json({ error: 'HAIR_PLY_URL not configured' }, { status: 503 });
  }

  const { searchParams } = req.nextUrl;
  const params = {
    pc1: searchParams.get('pc1') ?? '0',
    pc2: searchParams.get('pc2') ?? '0',
    pc3: searchParams.get('pc3') ?? '0',
    pc4: searchParams.get('pc4') ?? '0',
    pc5: searchParams.get('pc5') ?? '0',
    pc6: searchParams.get('pc6') ?? '0',
  };

  const qs = new URLSearchParams(params).toString();
  const upstream = await fetch(`${HAIR_PLY_URL}/hair?${qs}`, {
    headers: { 'ngrok-skip-browser-warning': 'true' },
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    return NextResponse.json({ error: `Hair server error: ${text}` }, { status: 502 });
  }

  const buffer = await upstream.arrayBuffer();
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': upstream.headers.get('Content-Disposition') ?? 'attachment; filename=hair.ply',
    },
  });
}
