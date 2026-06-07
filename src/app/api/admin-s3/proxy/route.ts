import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.AWS_S3_BUCKET_NAME!;

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get('key');
  if (!key) return new Response('missing key', { status: 400 });

  if (!key.startsWith('facelifts/') && !key.startsWith('pictures/')) {
    return new Response('forbidden', { status: 403 });
  }

  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    if (!res.Body) return new Response('not found', { status: 404 });

    const bytes = await res.Body.transformToByteArray();
    return new Response(bytes.buffer as ArrayBuffer, {
      headers: {
        'Content-Type': res.ContentType ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    console.error('proxy error', err);
    return new Response(String(err), { status: 500 });
  }
}
