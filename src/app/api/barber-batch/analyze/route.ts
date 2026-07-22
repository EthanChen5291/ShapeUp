import { ConvexHttpClient } from 'convex/browser';
import { NextRequest, NextResponse } from 'next/server';
import { api } from '@convex/_generated/api';
import { analyzeBarberSelfie, BarberAnalysisError } from '@/lib/barberBatchAnalyzer';
import { enforceDurableRateLimits } from '@/lib/durableRateLimit';
import { getClientIp, hashIdentifier, RATE_LIMITS } from '@/lib/rateLimit';
import { requireSignedIn } from '@/lib/serverAuth';

export async function POST(req: NextRequest) {
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
      route: '/api/barber-batch/analyze',
      user: hashIdentifier(authResult.session.userId),
      ip: hashIdentifier(ip),
    },
  );
  if (rateLimited) return rateLimited;

  let selfieUrl: unknown;
  let barberSlug: unknown;
  try {
    ({ selfieUrl, barberSlug } = await req.json() as Record<string, unknown>);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof selfieUrl !== 'string' || !selfieUrl || typeof barberSlug !== 'string' || !barberSlug) {
    return NextResponse.json(
      { ok: false, error: 'selfieUrl and barberSlug are required' },
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

  try {
    const analysis = await analyzeBarberSelfie({
      selfieUrl,
      offersPerms: page.offersPerms,
      requestUrl: req.url,
      requestHeaders: req.headers,
    });
    return NextResponse.json(analysis);
  } catch (error) {
    if (error instanceof BarberAnalysisError) {
      return NextResponse.json(
        { ok: false, error: error.publicMessage },
        { status: error.status },
      );
    }
    console.error('[barber-batch-analyze] analysis failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: 'The selfie analysis did not finish. Please try again.' },
      { status: 502 },
    );
  }
}
