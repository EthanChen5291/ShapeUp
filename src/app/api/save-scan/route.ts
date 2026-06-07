import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import { uploadToS3, getSignedDownloadUrl } from '@/lib/s3';
import { requireSignedIn } from '@/lib/serverAuth';

export async function POST(req: NextRequest) {
  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const convexToken = await authResult.session.getToken({ template: 'convex' });
  if (!convexToken) {
    return NextResponse.json({ ok: false, error: 'Convex auth token unavailable' }, { status: 401 });
  }
  convex.setAuth(convexToken);
  console.log('[save-scan] POST received');

  let imageDataUrl: string;
  let currentProfile: unknown = null;
  try {
    const body = await req.json();
    imageDataUrl = body.imageDataUrl;
    currentProfile = body.currentProfile ?? null;
    console.log('[save-scan] body parsed, imageDataUrl length:', imageDataUrl?.length ?? 'missing');
  } catch (err) {
    console.error('[save-scan] failed to parse request body:', err);
    return NextResponse.json({ ok: false, error: 'invalid JSON body', detail: String(err) }, { status: 400 });
  }

  if (!imageDataUrl) {
    console.error('[save-scan] imageDataUrl missing from body');
    return NextResponse.json({ ok: false, error: 'imageDataUrl is required' }, { status: 400 });
  }

  const base64 = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');
  console.log('[save-scan] buffer size:', buffer.length, 'bytes');

  const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Upload scan image to S3
  const scanS3Key = `pictures/${sessionId}/scan.png`;
  let downloadUrl: string | null = null;
  try {
    await uploadToS3(scanS3Key, buffer, 'image/png');
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
  // Fall back to the original data URL if S3 upload failed so the session still works
  return NextResponse.json({ ok: true, sessionId, downloadUrl: downloadUrl ?? imageDataUrl });
}
