export const maxDuration = 300;

import { ConvexHttpClient } from 'convex/browser';
import { ConvexError } from 'convex/values';
import { NextRequest, NextResponse } from 'next/server';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { analyzeBarberSelfie, BarberAnalysisError } from '@/lib/barberBatchAnalyzer';
import { orchestrateBarberBatch } from '@/lib/barberBatchOrchestrator';
import {
  claimBarberBatchStation,
  createBarberBatchPipelineDependencies,
} from '@/lib/barberBatchServer';
import { enforceDurableRateLimits } from '@/lib/durableRateLimit';
import { isFaceliftConfigured } from '@/lib/facelift';
import { getClientIp, hashIdentifier, RATE_LIMITS } from '@/lib/rateLimit';
import { requireSignedIn } from '@/lib/serverAuth';

function convexErrorResponse(error: ConvexError<string | { code?: string; message?: string }>) {
  const data = error.data && typeof error.data === 'object'
    ? error.data
    : { message: typeof error.data === 'string' ? error.data : error.message };
  const message = data.message ?? error.message;
  return NextResponse.json(
    { ok: false, error: message, code: data.code },
    { status: data.code === 'network_limited' ? 429 : 403 },
  );
}

export async function POST(req: NextRequest) {
  if (!isFaceliftConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'The 3D rendering service is unavailable.' },
      { status: 503 },
    );
  }

  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;
  const ip = getClientIp(req);
  const rateLimited = await enforceDurableRateLimits(
    [
      { ...RATE_LIMITS.summaryUser, key: authResult.session.userId },
      { ...RATE_LIMITS.summaryIp, key: ip },
    ],
    authResult.session,
    {
      route: '/api/barber-batch',
      user: hashIdentifier(authResult.session.userId),
      ip: hashIdentifier(ip),
    },
  );
  if (rateLimited) return rateLimited;

  let barberSlug: unknown;
  let selfieStorageId: unknown;
  let fingerprint: unknown;
  try {
    const body = await req.json() as Record<string, unknown>;
    barberSlug = body.barberSlug;
    selfieStorageId = body.selfieStorageId;
    fingerprint = body.fingerprint;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  if (
    typeof barberSlug !== 'string' || !barberSlug ||
    typeof selfieStorageId !== 'string' || !selfieStorageId
  ) {
    return NextResponse.json(
      { ok: false, error: 'barberSlug and selfieStorageId are required' },
      { status: 400 },
    );
  }

  const token = await authResult.session.getToken({ template: 'convex' });
  if (!token || !process.env.NEXT_PUBLIC_CONVEX_URL) {
    return NextResponse.json({ ok: false, error: 'Convex auth token unavailable' }, { status: 401 });
  }
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
  convex.setAuth(token);

  const page = await convex.query(api.barberPages.getBySlug, { slug: barberSlug });
  if (!page) {
    return NextResponse.json({ ok: false, error: 'Barber page not found' }, { status: 404 });
  }
  const storageId = selfieStorageId as Id<'_storage'>;
  const selfieUrl = await convex.query(api.barberTryOn.getUploadedImageUrl, { storageId });
  if (!selfieUrl) {
    return NextResponse.json({ ok: false, error: 'Selfie not found' }, { status: 404 });
  }

  let hasConsent = await convex.query(api.users.hasBiometricConsent, {});
  if (!hasConsent) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    hasConsent = await convex.query(api.users.hasBiometricConsent, {});
  }
  if (!hasConsent) {
    return NextResponse.json(
      { ok: false, error: 'Biometric consent is required before 3D processing' },
      { status: 403 },
    );
  }

  const pipeline = createBarberBatchPipelineDependencies({
    convex,
    selfieUrl,
    requestUrl: req.url,
    requestHeaders: req.headers,
  });
  try {
    const result = await orchestrateBarberBatch({
      ...pipeline,
      analyze: async () => await analyzeBarberSelfie({
        selfieUrl,
        offersPerms: page.offersPerms,
        requestUrl: req.url,
        requestHeaders: req.headers,
      }),
      consumeEntitlement: async () => {
        await convex.mutation(api.barberBatch.consumeBatch, {
          ipHash: hashIdentifier(ip),
          fingerprintHash: typeof fingerprint === 'string' && fingerprint.length > 0
            ? hashIdentifier(fingerprint.slice(0, 512))
            : undefined,
        });
      },
      createBatch: async () => String(await convex.mutation(api.barberBatch.create, {
        slug: barberSlug,
        selfieStorageId: storageId,
      })),
      setAnalysis: async (batchId, analysis) => {
        const seeded = await convex.mutation(api.barberBatch.setAnalysis, {
          batchId: batchId as Id<'barberBatches'>,
          result: {
            ok: true,
            hairProfile: analysis.hairProfile,
            items: analysis.items,
          },
        });
        return seeded.items.map((item) => ({ idx: item.idx, itemId: String(item.itemId) }));
      },
      claimStation: async (batchId) => await claimBarberBatchStation(
        convex,
        `barber-batch:${batchId}`,
      ),
      finishBatch: async (batchId) => (
        await convex.mutation(api.barberBatch.finish, {
          batchId: batchId as Id<'barberBatches'>,
        })
      ).status,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, rejected: true, reason: result.reason });
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BarberAnalysisError) {
      return NextResponse.json(
        { ok: false, error: error.publicMessage },
        { status: error.status },
      );
    }
    if (error instanceof ConvexError) return convexErrorResponse(error);
    console.error('[barber-batch] orchestration failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: 'The hairstyle batch did not finish. Please try again.' },
      { status: 500 },
    );
  }
}
