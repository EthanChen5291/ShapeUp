// POST → raise a token-refund request for a project. We read the project's
// selfie + splat S3 keys server-side (via an authed Convex query), presign them
// for the Discord embed (S3 signing lives in Next.js, not Convex), then record
// the request through refunds.submitRequest.
import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import { Id } from '@convex/_generated/dataModel';
import { requireSignedIn } from '@/lib/serverAuth';
import { getSignedDownloadUrl } from '@/lib/s3';

export async function POST(req: NextRequest) {
  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;

  let body: { projectId?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const convexToken = await authResult.session.getToken({ template: 'convex' });
  if (!convexToken) {
    return NextResponse.json({ error: 'Convex auth token unavailable' }, { status: 401 });
  }
  convex.setAuth(convexToken);

  try {
    const projectId = body.projectId as Id<'projects'>;
    const project = await convex.query(api.projects.get, { projectId });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const selfieKey = project.lastEditImageS3Key ?? project.lastImageS3Key;
    const splatKey = project.splatS3Key;

    // Presign for the Discord embed. Failures here are non-fatal — the request
    // is still worth recording even if a preview link can't be generated.
    const selfieUrl = selfieKey
      ? await getSignedDownloadUrl(selfieKey).catch(() => undefined)
      : undefined;
    const splatUrl = splatKey
      ? await getSignedDownloadUrl(splatKey).catch(() => undefined)
      : undefined;

    const result = await convex.mutation(api.refunds.submitRequest, {
      projectId,
      reason: body.reason,
      selfieUrl,
      splatUrl,
      adminUrl: `${req.nextUrl.origin}/admin/refunds`,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('refund-request error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
