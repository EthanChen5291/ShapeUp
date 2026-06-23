// GET  → recent refund requests, each with presigned selfie + splat URLs.
// POST → resolve a request: { requestId, action: 'approve' | 'deny', tokens? }.
import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import { Id } from '@convex/_generated/dataModel';
import { requireAdmin } from '@/lib/serverAuth';
import { getSignedDownloadUrl } from '@/lib/s3';

async function authedConvex() {
  const authResult = await requireAdmin();
  if (authResult.response) return { response: authResult.response, convex: null as ConvexHttpClient | null };

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const convexToken = await authResult.session.getToken({ template: 'convex' });
  if (!convexToken) {
    return {
      response: NextResponse.json({ error: 'Convex auth token unavailable' }, { status: 401 }),
      convex: null,
    };
  }
  convex.setAuth(convexToken);
  return { response: null, convex };
}

export async function GET() {
  const { response, convex } = await authedConvex();
  if (response) return response;

  try {
    const rows = await convex!.query(api.refunds.listRecent, { limit: 200 });
    const requests = await Promise.all(
      rows.map(async (r) => ({
        id: r._id,
        status: r.status,
        reason: r.reason,
        username: r.username,
        email: r.email,
        projectId: r.projectId,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
        refundedTokens: r.refundedTokens,
        selfieUrl: r.selfieS3Key ? await getSignedDownloadUrl(r.selfieS3Key).catch(() => null) : null,
        splatUrl: r.splatS3Key ? await getSignedDownloadUrl(r.splatS3Key).catch(() => null) : null,
      })),
    );
    return NextResponse.json({ requests });
  } catch (err) {
    console.error('admin-refunds GET error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { response, convex } = await authedConvex();
  if (response) return response;

  let body: { requestId?: string; action?: 'approve' | 'deny'; tokens?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.requestId || (body.action !== 'approve' && body.action !== 'deny')) {
    return NextResponse.json({ error: 'requestId and action (approve|deny) are required' }, { status: 400 });
  }

  try {
    const result = await convex!.mutation(api.refunds.resolve, {
      requestId: body.requestId as Id<'refundRequests'>,
      action: body.action,
      tokens: body.tokens,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('admin-refunds POST error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
