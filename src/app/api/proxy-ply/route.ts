// GET ?url=<encoded-firebase-storage-url> → binary PLY
// Proxies Firebase Storage through the Next.js server to avoid browser CORS blocks.

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'url param required' }, { status: 400 });
  }

  console.log(`[proxy-ply] fetching ${url.slice(0, 80)}…`);
  const upstream = await fetch(url);
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    console.error(`[proxy-ply] upstream ${upstream.status}: ${text.slice(0, 200)}`);
    return NextResponse.json({ error: `Upstream error: ${upstream.status}` }, { status: 502 });
  }

  const buffer = await upstream.arrayBuffer();
  console.log(`[proxy-ply] serving ${buffer.byteLength} bytes`);

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
