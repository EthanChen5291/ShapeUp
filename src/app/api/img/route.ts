import { NextRequest, NextResponse } from 'next/server';
import { getSignedDownloadUrl } from '@/lib/s3';

// Only these S3 key prefixes can be served through this route.
const ALLOWED_PREFIXES = ['thumbnails/', 'pictures/', 'edit-images/'];

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (!key) return new NextResponse('Missing key', { status: 400 });

  if (!ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Proxy the bytes instead of redirecting to a presigned URL. The presigned
  // URL is generated and consumed server-side within this request, so it never
  // reaches a cache. The cached resource is the image itself, keyed by ?key=,
  // and these keys are immutable (uuid thumbnails / per-session scan paths) —
  // safe to cache long. Previously the 302 redirect was cached, so the browser
  // kept reusing a single stale signed URL and some previews would vanish.
  let signedUrl: string;
  try {
    signedUrl = await getSignedDownloadUrl(key);
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }

  const upstream = await fetch(signedUrl);
  if (!upstream.ok) {
    return new NextResponse('Not found', { status: 404 });
  }

  const buffer = await upstream.arrayBuffer();
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
    },
  });
}
