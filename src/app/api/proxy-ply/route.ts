// GET ?url=<encoded-url> or ?key=<s3-key> → 302 redirect to the splat/PLY source.
//
// We redirect rather than stream the bytes through this function for two reasons:
//   1. Vercel serverless responses are capped at ~4.5 MB; splats are routinely
//      larger, so proxying the body fails in production.
//   2. drei's SplatLoader requires a Content-Length header — Vercel drops the
//      explicit one when it re-chunks proxied bodies. S3 always sends a correct
//      Content-Length, so fetching the source directly satisfies the loader.
//
// fetch() (which the loaders use) follows the redirect transparently, so the
// browser downloads straight from S3. This requires the bucket to allow CORS GET
// from the app origin — see scripts/apply-s3-cors.ts.

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

  let targetUrl: string;

  if (key) {
    if (!KEY_ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      return NextResponse.json({ error: 'key prefix not allowed' }, { status: 400 });
    }
    try {
      targetUrl = await getSignedDownloadUrl(key);
    } catch {
      return NextResponse.json({ error: 'Failed to generate signed URL' }, { status: 500 });
    }
  } else {
    if (!isSafeRemoteUrl(url!)) {
      return NextResponse.json({ error: 'url is not allowed' }, { status: 400 });
    }
    targetUrl = url!;
  }

  // In local dev, stream the bytes through to avoid S3 CORS issues.
  // In production (Vercel) redirect instead to avoid the 4.5 MB response size cap.
  if (process.env.NODE_ENV === 'development') {
    const upstream = await fetch(targetUrl);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `Upstream fetch failed (${upstream.status})` }, { status: 502 });
    }
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/octet-stream',
        'Content-Length': upstream.headers.get('Content-Length') ?? '',
        'Cache-Control': 'no-store',
      },
    });
  }

  console.log(`[proxy-ply] redirecting to ${targetUrl.slice(0, 80)}…`);
  return NextResponse.redirect(targetUrl, 307);
}
