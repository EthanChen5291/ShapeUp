export const maxDuration = 300;

import { ConvexHttpClient } from 'convex/browser';
import { NextRequest, NextResponse } from 'next/server';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import {
  BARBER_BATCH_BUDGET_ERROR,
  combineBarberBatchPrompt,
  runBarberBatchPipeline,
} from '@/lib/barberBatchOrchestrator';
import {
  claimBarberBatchStation,
  createBarberBatchPipelineDependencies,
} from '@/lib/barberBatchServer';
import { enforceDurableRateLimits } from '@/lib/durableRateLimit';
import { isFaceliftConfigured } from '@/lib/facelift';
import { getClientIp, hashIdentifier, RATE_LIMITS } from '@/lib/rateLimit';
import { requireSignedIn } from '@/lib/serverAuth';

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
    [{ ...RATE_LIMITS.barberBatchRetryUser, key: authResult.session.userId }],
    authResult.session,
    {
      route: '/api/barber-batch/item',
      user: hashIdentifier(authResult.session.userId),
      ip: hashIdentifier(ip),
    },
  );
  if (rateLimited) return rateLimited;

  let itemId: unknown;
  let extraPrompt: unknown;
  try {
    const body = await req.json() as Record<string, unknown>;
    itemId = body.itemId;
    extraPrompt = body.extraPrompt;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof itemId !== 'string' || !itemId) {
    return NextResponse.json({ ok: false, error: 'itemId is required' }, { status: 400 });
  }
  if (extraPrompt !== undefined && typeof extraPrompt !== 'string') {
    return NextResponse.json({ ok: false, error: 'extraPrompt must be a string' }, { status: 400 });
  }
  const cleanExtraPrompt = typeof extraPrompt === 'string' ? extraPrompt.trim() : '';
  if (cleanExtraPrompt.length > 200) {
    return NextResponse.json(
      { ok: false, error: 'extraPrompt must be at most 200 characters' },
      { status: 400 },
    );
  }

  const token = await authResult.session.getToken({ template: 'convex' });
  if (!token || !process.env.NEXT_PUBLIC_CONVEX_URL) {
    return NextResponse.json({ ok: false, error: 'Convex auth token unavailable' }, { status: 401 });
  }
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
  convex.setAuth(token);

  const item = await convex.query(api.barberBatch.getItemForRetry, {
    itemId: itemId as Id<'barberBatchItems'>,
  });
  const finalTouch = cleanExtraPrompt.length > 0;
  if (item.status !== 'failed' && !(item.status === 'done' && finalTouch)) {
    return NextResponse.json(
      { ok: false, error: 'Only a failed style can be retried without final touches.' },
      { status: 409 },
    );
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

  const prompt = combineBarberBatchPrompt(item.prompt, cleanExtraPrompt || undefined);
  const dependencies = createBarberBatchPipelineDependencies({
    convex,
    selfieUrl: item.selfieUrl,
    requestUrl: req.url,
    requestHeaders: req.headers,
  });
  let releaseStation = async () => {};
  try {
    releaseStation = await claimBarberBatchStation(convex, `barber-batch-item:${item.itemId}`);
  } catch {
    // Queue visibility is best-effort; the worker remains the source of truth.
  }

  let outcomes;
  try {
    outcomes = await runBarberBatchPipeline(
      [{
        itemId: String(item.itemId),
        idx: item.idx,
        title: item.title,
        prompt,
        persistPrompt: finalTouch,
      }],
      dependencies,
      { editConcurrency: 1, renderConcurrency: 1 },
    );
  } finally {
    await releaseStation().catch(() => {});
  }

  let batchStatus: 'ready' | 'failed' | undefined;
  try {
    batchStatus = (
      await convex.mutation(api.barberBatch.finish, { batchId: item.batchId })
    ).status;
  } catch (error) {
    console.warn('[barber-batch-item] parent batch is not settled yet', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const outcome = outcomes[0];
  if (!outcome || outcome.status === 'failed') {
    const error = outcome?.error ?? "This style couldn't be regenerated. Please try again.";
    return NextResponse.json(
      { ok: false, error, batchStatus },
      { status: error === BARBER_BATCH_BUDGET_ERROR ? 503 : 502 },
    );
  }
  return NextResponse.json({ ok: true, itemId: item.itemId, batchStatus });
}
