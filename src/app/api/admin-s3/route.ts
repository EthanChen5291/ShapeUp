import { NextResponse } from 'next/server';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireAdmin } from '@/lib/serverAuth';

const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.AWS_S3_BUCKET_NAME!;

async function sign(key: string) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 3600 });
}

export async function GET(req: Request) {
  const authResult = await requireAdmin();
  if (authResult.response) return authResult.response;

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') ?? 'images';
  const search = (searchParams.get('search') ?? '').toLowerCase();
  const dateFrom = searchParams.get('dateFrom') ?? '';
  const dateTo = searchParams.get('dateTo') ?? '';

  const prefix = section === 'facelifts' ? 'facelifts/' : 'pictures/';

  try {
    const allObjects: { key: string; lastModified: Date; size: number }[] = [];
    let continuationToken: string | undefined;

    do {
      const res = await s3.send(
        new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: continuationToken }),
      );
      for (const obj of res.Contents ?? []) {
        if (obj.Key && obj.LastModified) {
          allObjects.push({ key: obj.Key, lastModified: obj.LastModified, size: obj.Size ?? 0 });
        }
      }
      continuationToken = res.NextContinuationToken;
    } while (continuationToken);

    // Group by second path segment (sessionId or jobId)
    const groups = new Map<string, { id: string; files: typeof allObjects; lastModified: Date }>();
    for (const obj of allObjects) {
      const parts = obj.key.split('/');
      const id = parts[1];
      if (!id) continue;
      if (!groups.has(id)) groups.set(id, { id, files: [], lastModified: obj.lastModified });
      const g = groups.get(id)!;
      g.files.push(obj);
      if (obj.lastModified > g.lastModified) g.lastModified = obj.lastModified;
    }

    let results = Array.from(groups.values()).sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

    if (search) results = results.filter((r) => r.id.toLowerCase().includes(search));

    if (dateFrom) {
      const from = new Date(dateFrom + 'T00:00:00Z');
      results = results.filter((r) => r.lastModified >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo + 'T23:59:59Z');
      results = results.filter((r) => r.lastModified <= to);
    }

    const total = results.length;
    results = results.slice(0, 100);

    const withUrls = await Promise.all(
      results.map(async (g) => ({
        id: g.id,
        lastModified: g.lastModified.toISOString(),
        files: await Promise.all(
          g.files.map(async (f) => ({
            key: f.key,
            filename: f.key.split('/').at(-1) ?? f.key,
            size: f.size,
            lastModified: f.lastModified.toISOString(),
            url: await sign(f.key),
          })),
        ),
      })),
    );

    return NextResponse.json({ results: withUrls, total });
  } catch (err) {
    console.error('admin-s3 error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
