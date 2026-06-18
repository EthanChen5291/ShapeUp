import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import { uploadToS3, getSignedDownloadUrl } from '@/lib/s3';
import { requireSignedIn } from '@/lib/serverAuth';
import { RATE_LIMITS, getClientIp, hashIdentifier } from '@/lib/rateLimit';
import { enforceDurableRateLimits } from '@/lib/durableRateLimit';
import { parseImageDataUrl } from '@/lib/imageDataUrl';

const MAX_SCAN_IMAGE_BYTES = 6 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;

  const ip = getClientIp(req);
  const rateLimited = await enforceDurableRateLimits([
    { ...RATE_LIMITS.saveScanUser, key: authResult.session.userId },
    { ...RATE_LIMITS.saveScanIp, key: ip },
  ], authResult.session, {
    route: '/api/save-scan',
    user: hashIdentifier(authResult.session.userId),
    ip: hashIdentifier(ip),
  });
  if (rateLimited) return rateLimited;

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const convexToken = await authResult.session.getToken({ template: 'convex' });
  if (!convexToken) {
    return NextResponse.json({ ok: false, error: 'Convex auth token unavailable' }, { status: 401 });
  }
  convex.setAuth(convexToken);
  const hasConsent = await convex.query(api.users.hasBiometricConsent, {});
  if (!hasConsent) {
    console.warn('[save-scan] rejected missing biometric consent', {
      user: hashIdentifier(authResult.session.userId),
    });
    return NextResponse.json({ ok: false, error: 'Biometric consent is required before scan upload' }, { status: 403 });
  }
  console.log('[save-scan] POST received');

  let imageDataUrl: unknown;
  let currentProfile: unknown = null;
  try {
    const body = await req.json() as { imageDataUrl?: unknown; currentProfile?: unknown };
    imageDataUrl = body.imageDataUrl;
    currentProfile = body.currentProfile ?? null;
    console.log('[save-scan] body parsed, imageDataUrl length:', typeof imageDataUrl === 'string' ? imageDataUrl.length : 'missing');
  } catch (err) {
    console.error('[save-scan] failed to parse request body:', err);
    return NextResponse.json({ ok: false, error: 'invalid JSON body', detail: String(err) }, { status: 400 });
  }

  const parsedImage = parseImageDataUrl(imageDataUrl, { maxBytes: MAX_SCAN_IMAGE_BYTES });
  if (!parsedImage.ok) {
    console.warn('[save-scan] rejected image payload', {
      reason: parsedImage.error,
      user: hashIdentifier(authResult.session.userId),
    });
    return NextResponse.json({ ok: false, error: parsedImage.error }, { status: 400 });
  }
  const { buffer } = parsedImage;
  console.log('[save-scan] buffer size:', buffer.length, 'bytes');

  const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Upload scan image to S3. The S3 path uses a CSPRNG UUID — NOT the sessionId,
  // which embeds a millisecond timestamp + non-crypto Math.random() suffix and is
  // therefore guessable. Face scans are biometric data, so the key must be
  // unguessable (matching the randomUUID() keys used for thumbnails/edit-images).
  const scanS3Key = `pictures/${randomUUID()}/scan.png`;
  let downloadUrl: string | null = null;
  try {
    await uploadToS3(scanS3Key, buffer, parsedImage.mimeType);
    downloadUrl = await getSignedDownloadUrl(scanS3Key);
    console.log('[save-scan] uploaded to S3:', scanS3Key);
  } catch (err) {
    console.error('[save-scan] S3 upload failed (non-fatal):', err);
  }

  // Store session metadata in Convex — store the S3 key, not the signed URL (URLs expire)
  try {
    await convex.mutation(api.sessions.create, {
      sessionId,
      currentProfile: currentProfile ?? undefined,
      imageUrl: scanS3Key ?? undefined,
      scanS3Key,
    });
    console.log('[save-scan] session stored in Convex, id:', sessionId);
  } catch (err) {
    console.error('[save-scan] Convex session insert failed (non-fatal):', err);
  }

  console.log('[save-scan] done — sessionId:', sessionId);
  // Fall back to the original data URL if S3 upload failed so the session still works.
  // Return the real scanS3Key (a CSPRNG-UUID path the client cannot reconstruct) so
  // callers persist the key the bytes actually live at. Only when upload succeeded —
  // downloadUrl is null on S3 failure, in which case there is no object to point to.
  return NextResponse.json({
    ok: true,
    sessionId,
    downloadUrl: downloadUrl ?? imageDataUrl,
    scanS3Key: downloadUrl ? scanS3Key : null,
  });
}
