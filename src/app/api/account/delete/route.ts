import { NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
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
    const deletion = await convex.mutation(api.users.deleteCurrentUserData, {});
    await deleteManyFromS3(deletion.s3Keys);

    const client = await clerkClient();
    await client.users.deleteUser(authResult.session.userId);

    console.warn('[account-delete] completed', {
      user: hashIdentifier(authResult.session.userId),
      s3KeyCount: deletion.s3Keys.length,
    });

    return NextResponse.json({
      ok: true,
      deletedS3Keys: deletion.s3Keys.length,
      warning: deletion.warning,
    });
  } catch (err) {
    console.error('[account-delete] failed', {
      user: hashIdentifier(authResult.session.userId),
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Account deletion failed' }, { status: 500 });
  }
}
