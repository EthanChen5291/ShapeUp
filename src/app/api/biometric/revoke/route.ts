import { NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import { requireSignedIn } from '@/lib/serverAuth';
import { deleteManyFromS3 } from '@/lib/s3';
import { hashIdentifier } from '@/lib/rateLimit';

export async function POST() {
  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;

  const convexToken = await authResult.session.getToken({ template: 'convex' });
  if (!convexToken) {
    return NextResponse.json({ error: 'Convex auth token unavailable' }, { status: 401 });
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(convexToken);

  try {
    const result = await convex.mutation(api.users.revokeBiometricConsent, {});
    await deleteManyFromS3(result.s3Keys);

    console.warn('[biometric-revoke] completed', {
      user: hashIdentifier(authResult.session.userId),
      s3KeyCount: result.s3Keys.length,
    });

    return NextResponse.json({ ok: true, deletedS3Keys: result.s3Keys.length });
  } catch (err) {
    console.error('[biometric-revoke] failed', {
      user: hashIdentifier(authResult.session.userId),
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Revoke failed' }, { status: 500 });
  }
}
