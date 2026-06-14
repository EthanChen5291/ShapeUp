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

  try {
    const url = await getSignedDownloadUrl(key);
    // Presigned URL is valid for 7 days. Cache the redirect for 23 hours
    // so the browser revalidates well before expiry.
    const response = NextResponse.redirect(url, { status: 302 });
    response.headers.set('Cache-Control', 'public, max-age=82800, s-maxage=82800');
    return response;
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
