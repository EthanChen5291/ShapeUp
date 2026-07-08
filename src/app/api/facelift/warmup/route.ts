// POST /api/facelift/warmup — best-effort GPU pre-warm.
//
// Fired (fire-and-forget) by the client the instant an edit starts, in parallel
// with /api/gemini-hair-edit. Image-model generation takes ~8-12s; the primary
// worker's container cold start is ~6-8s. Waking the container now overlaps
// that cold start with the image edit instead of stacking it after — so by the
// time the real /api/facelift call lands (just after the edited image comes
// back), the GPU is already loaded.
//
// Deliberately does NONE of the gating /api/facelift does — no biometric
// consent, no GPU-budget check, and crucially no consumeGeneration. A warmup
// must never spend a credit or one of the user's free generations. It only authenticates
// (a wake costs a cold start, so it can't be anonymous) and rate-limits.

import { NextRequest, NextResponse } from 'next/server';
import { RATE_LIMITS, getClientIp, hashIdentifier } from '@/lib/rateLimit';
import { enforceDurableRateLimits } from '@/lib/durableRateLimit';
import { requireSignedIn } from '@/lib/serverAuth';
import { getFaceliftHeaders, resolveFaceliftUpstreams } from '@/lib/facelift';

// Cold start is ~6-8s; give the wake room to finish so the container is actually
// up by the time we return, without hanging the serverless function.
const WARMUP_TIMEOUT_MS = 15_000;

export async function POST(req: NextRequest) {
  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;

  const ip = getClientIp(req);
  const rateLimited = await enforceDurableRateLimits([
    { ...RATE_LIMITS.faceliftWarmupUser, key: authResult.session.userId },
    { ...RATE_LIMITS.faceliftWarmupIp, key: ip },
  ], authResult.session, {
    route: '/api/facelift/warmup',
    user: hashIdentifier(authResult.session.userId),
    ip: hashIdentifier(ip),
  });
  if (rateLimited) return rateLimited;

  // Only warm the upstream that would actually serve the next request. When
  // the secondary worker is up it's first in priority and is always warm (a
  // manual GPU box with no cold start), so the primary worker would only be a
  // fallback — waking it then is wasted GPU spend. So we warm only when the
  // primary worker is the top upstream.
  const upstreams = await resolveFaceliftUpstreams();
  const top = upstreams[0];
  if (!top || top.name !== 'primary') {
    return NextResponse.json({ ok: true, warmed: false });
  }

  try {
    const res = await fetch(`${top.url}/warmup`, {
      method: 'POST',
      headers: getFaceliftHeaders(),
      signal: AbortSignal.timeout(WARMUP_TIMEOUT_MS),
    });
    // Don't fail the user over a warmup miss — the real /api/facelift call still
    // works (it just pays the cold start). Report it, never throw it.
    return NextResponse.json({ ok: true, warmed: res.ok });
  } catch (err) {
    console.warn('[facelift/warmup] wake failed (non-fatal):', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: true, warmed: false });
  }
}
