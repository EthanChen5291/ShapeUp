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

  console.log(`[proxy-ply] redirecting to ${targetUrl.slice(0, 80)}…`);
  // 307 preserves the GET and is not cached, so each request re-resolves a fresh
  // (possibly re-signed) URL.
  return NextResponse.redirect(targetUrl, 307);
}
