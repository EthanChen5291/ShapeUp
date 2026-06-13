// GET ?url=<encoded-url> or ?key=<s3-key> → binary splat/PLY
// Proxies remote storage through the Next.js server to avoid browser CORS blocks.

import { NextRequest, NextResponse } from 'next/server';
import { isSafeRemoteUrl } from '@/lib/urlSafety';
import { getSignedDownloadUrl } from '@/lib/s3';

const KEY_ALLOWED_PREFIXES = ['facelifts/'];

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  const key = req.nextUrl.searchParams.get('key');

  if (!url && !key) {
    return NextResponse.json({ error: 'url or key param required' }, { status: 400 });
  }

  let fetchUrl: string;

  if (key) {
    if (!KEY_ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      return NextResponse.json({ error: 'key prefix not allowed' }, { status: 400 });
    }
    try {
      fetchUrl = await getSignedDownloadUrl(key);
    } catch {
      return NextResponse.json({ error: 'Failed to generate signed URL' }, { status: 500 });
    }
  } else {
    if (!isSafeRemoteUrl(url!)) {
      return NextResponse.json({ error: 'url is not allowed' }, { status: 400 });
    }
    fetchUrl = url!;
  }

  console.log(`[proxy-ply] fetching ${fetchUrl.slice(0, 80)}…`);
  const upstream = await fetch(fetchUrl);
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
