// POST { fingerprint? } → { ok: true } | { error }
// Consumes one generation entitlement (a paid credit, else the one-time free gen).
//
// The edit pipeline normally spends its token inside /api/facelift (the 3D
// render step). When the user cancels during the earlier Gemini step — before
// facelift is ever called — that step has still cost us a Gemini call, so we
// charge the token here. Callers only hit this when no facelift request was
// started, so the two paths never double-charge.

import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import { getClientIp, hashIdentifier } from '@/lib/rateLimit';
import { requireSignedIn } from '@/lib/serverAuth';

export async function POST(req: NextRequest) {
  // Demo/allowlisted/paywall-off deployments don't meter tokens.
  if (process.env.DISABLE_PAYWALL === '1') {
    return NextResponse.json({ ok: true, skipped: 'paywall-disabled' });
  }

  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;
  const convexToken = await authResult.session.getToken({ template: 'convex' });
  if (!convexToken) {
    return NextResponse.json({ error: 'Convex auth token unavailable' }, { status: 401 });
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(convexToken);

  // Allowlisted demo/dev accounts bypass billing entirely (mirrors /api/facelift).
  try {
    if (await convex.query(api.users.isAllowlisted, {})) {
      return NextResponse.json({ ok: true, skipped: 'allowlisted' });
    }
  } catch (err) {
    console.error('[charge-edit] allowlist check failed (treating as non-demo):', err);
  }

  let fingerprint: unknown;
  try {
    ({ fingerprint } = await req.json());
  } catch {
    /* no body — fingerprint stays undefined, which consumeGeneration tolerates */
  }

  const ip = getClientIp(req);
  try {
    await convex.mutation(api.freeGen.consumeGeneration, {
      ipHash: hashIdentifier(ip),
      fingerprintHash: typeof fingerprint === 'string' && fingerprint.length > 0
        ? hashIdentifier(fingerprint)
        : undefined,
    });
  } catch (err) {
    // Out of credits / free gen exhausted — nothing to charge. The cancel still
    // succeeds on the client; we just report that no token was spent.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[charge-edit] consumeGeneration failed (non-fatal):', msg);
    return NextResponse.json({ ok: false, charged: false, error: msg });
  }

  return NextResponse.json({ ok: true, charged: true });
}
