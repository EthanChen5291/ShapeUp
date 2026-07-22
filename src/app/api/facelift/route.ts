export const maxDuration = 300;

import { ConvexHttpClient } from 'convex/browser';
import { ConvexError } from 'convex/values';
import { NextRequest, NextResponse } from 'next/server';
import { api } from '@convex/_generated/api';
import { enforceDurableRateLimits } from '@/lib/durableRateLimit';
import {
  FaceliftCoreError,
  MAX_FACELIFT_IMAGE_BYTES,
  runFaceliftCore,
} from '@/lib/faceliftCore';
import { isFaceliftConfigured } from '@/lib/facelift';
import { FREE_MODE } from '@/lib/freeMode';
import { parseImageDataUrl } from '@/lib/imageDataUrl';
import { getClientIp, hashIdentifier, RATE_LIMITS } from '@/lib/rateLimit';
import { getSignedDownloadUrl } from '@/lib/s3';
import { requireSignedIn } from '@/lib/serverAuth';

const DEMO_FACELIFT_USER_LIMIT = 20;

export async function POST(req: NextRequest) {
  if (!isFaceliftConfigured()) {
    console.error('[facelift-route] no render upstream configured');
    return NextResponse.json({ error: 'FaceLift upstream not configured' }, { status: 503 });
  }

  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;
  const convexToken = await authResult.session.getToken({ template: 'convex' });
  if (!convexToken) {
    return NextResponse.json({ error: 'Convex auth token unavailable' }, { status: 401 });
  }
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(convexToken);

  let isDemoUser = false;
  try {
    isDemoUser = await convex.query(api.users.isAllowlisted, {});
  } catch (error) {
    console.error('[facelift-route] allowlist check failed; using the standard limit', error);
  }

  const ip = getClientIp(req);
  const rateLimited = await enforceDurableRateLimits(
    [
      {
        ...RATE_LIMITS.faceliftUser,
        limit: isDemoUser ? DEMO_FACELIFT_USER_LIMIT : RATE_LIMITS.faceliftUser.limit,
        key: authResult.session.userId,
      },
      { ...RATE_LIMITS.faceliftIp, key: ip },
    ],
    authResult.session,
    {
      route: '/api/facelift',
      user: hashIdentifier(authResult.session.userId),
      ip: hashIdentifier(ip),
    },
  );
  if (rateLimited) return rateLimited;

  let hasConsent = await convex.query(api.users.hasBiometricConsent, {});
  if (!hasConsent) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    hasConsent = await convex.query(api.users.hasBiometricConsent, {});
  }
  if (!hasConsent) {
    return NextResponse.json(
      { error: 'Biometric consent is required before FaceLift processing' },
      { status: 403 },
    );
  }

  let imageDataUrl: unknown;
  let outputName = 'edit-output';
  let fingerprint: unknown;
  let needPly = false;
  try {
    const body = await req.json() as Record<string, unknown>;
    imageDataUrl = body.imageDataUrl;
    if (typeof body.outputName === 'string') outputName = body.outputName;
    fingerprint = body.fingerprint;
    needPly = body.needPly === true;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsedImage = parseImageDataUrl(imageDataUrl, { maxBytes: MAX_FACELIFT_IMAGE_BYTES });
  if (!parsedImage.ok) {
    return NextResponse.json({ error: parsedImage.error }, { status: 400 });
  }

  try {
    if (await convex.query(api.gpuUsage.isOverBudget, {})) {
      return NextResponse.json(
        { error: 'Demo GPU budget reached — try again next month' },
        { status: 503 },
      );
    }
  } catch (error) {
    console.error('[facelift-route] budget check failed; allowing the request', error);
  }

  if (!FREE_MODE && process.env.DISABLE_PAYWALL !== '1' && !isDemoUser) {
    try {
      await convex.mutation(api.freeGen.consumeGeneration, {
        ipHash: hashIdentifier(ip),
        fingerprintHash: typeof fingerprint === 'string' && fingerprint.length > 0
          ? hashIdentifier(fingerprint)
          : undefined,
      });
    } catch (error) {
      if (error instanceof ConvexError) {
        const data = error.data && typeof error.data === 'object'
          ? error.data as { code?: string; message?: string }
          : { message: typeof error.data === 'string' ? error.data : error.message };
        const message = data.message ?? error.message;
        const creditCodes = new Set(['out_of_credits', 'free_gen_used', 'network_limited']);
        const needsCredits = data.code
          ? creditCodes.has(data.code)
          : /out of credits|free generation/i.test(message);
        return NextResponse.json(
          { error: message, code: data.code, needsCredits },
          { status: 402 },
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error('[facelift-route] generation entitlement check failed', {
        error: message,
        user: hashIdentifier(authResult.session.userId),
      });
      return NextResponse.json(
        { error: `Couldn't verify your generation entitlement: ${message}` },
        { status: 502 },
      );
    }
  }

  let result;
  try {
    result = await runFaceliftCore({
      buffer: parsedImage.buffer,
      mimeType: parsedImage.mimeType,
      outputName,
      needPly,
    });
  } catch (error) {
    if (error instanceof FaceliftCoreError) {
      return NextResponse.json({ error: error.publicMessage }, { status: 502 });
    }
    console.error('[facelift-route] render core failed', error);
    return NextResponse.json({ error: 'FaceLift server unavailable' }, { status: 502 });
  }

  if (result.elapsedSeconds !== null) {
    try {
      await convex.mutation(api.gpuUsage.record, { seconds: result.elapsedSeconds });
    } catch (error) {
      console.error('[facelift-route] GPU usage update failed', error);
    }
  }

  try {
    await convex.mutation(api.facelifts.recordResult, {
      jobId: result.jobId,
      splatS3Key: result.splatS3Key,
      ...(result.plyS3Key ? { plyS3Key: result.plyS3Key } : {}),
    });
  } catch (error) {
    console.error('[facelift-route] durable result index update failed', error);
  }

  const [plyUrl, splatUrl, videoUrl] = await Promise.all([
    result.plyS3Key ? getSignedDownloadUrl(result.plyS3Key) : Promise.resolve(null),
    getSignedDownloadUrl(result.splatS3Key),
    result.videoS3Key ? getSignedDownloadUrl(result.videoS3Key) : Promise.resolve(null),
  ]);

  return NextResponse.json({
    jobId: result.jobId,
    splatUrl,
    plyUrl,
    videoUrl,
    splatS3Key: result.splatS3Key,
    videoS3Key: result.videoS3Key,
  });
}
