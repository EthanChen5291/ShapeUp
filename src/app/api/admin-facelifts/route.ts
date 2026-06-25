// GET → recent facelifts with presigned download URLs for the rendered ply + splat.
import { NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import { requireAdmin } from '@/lib/serverAuth';
import { getSignedDownloadUrl } from '@/lib/s3';

export async function GET() {
  const authResult = await requireAdmin();
  if (authResult.response) return authResult.response;

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const convexToken = await authResult.session.getToken({ template: 'convex' });
  if (!convexToken) {
    return NextResponse.json({ error: 'Convex auth token unavailable' }, { status: 401 });
  }
  convex.setAuth(convexToken);

  try {
    const rows = await convex.query(api.facelifts.listRecent, {});
    const facelifts = await Promise.all(
      rows.map(async (r) => ({
        id: r._id,
        jobId: r.jobId,
        userId: r.userId,
        createdAt: r._creationTime,
        plyKey: r.plyS3Key ?? null,
        splatKey: r.splatS3Key,
        plyUrl: r.plyS3Key ? await getSignedDownloadUrl(r.plyS3Key) : null,
        splatUrl: await getSignedDownloadUrl(r.splatS3Key),
      })),
    );
    return NextResponse.json({ facelifts });
  } catch (err) {
    console.error('admin-facelifts error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
