import { NextRequest, NextResponse } from 'next/server';
import { uploadToS3 } from '@/lib/s3';
import { randomUUID } from 'crypto';

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? 'image/png';
  const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';
  const buffer = Buffer.from(await req.arrayBuffer());
  const key = `edit-images/${randomUUID()}.${ext}`;
  await uploadToS3(key, buffer, contentType);
  return NextResponse.json({ key });
}
