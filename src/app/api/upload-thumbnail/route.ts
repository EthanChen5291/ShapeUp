import { NextRequest, NextResponse } from 'next/server';
import { uploadToS3, getSignedDownloadUrl } from '@/lib/s3';
import { randomUUID } from 'crypto';

export async function POST(req: NextRequest) {
  const buffer = Buffer.from(await req.arrayBuffer());
  const key = `thumbnails/${randomUUID()}.jpg`;
  await uploadToS3(key, buffer, 'image/jpeg');
  const url = await getSignedDownloadUrl(key);
  return NextResponse.json({ url });
}
