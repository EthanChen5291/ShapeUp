import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function POST(req: NextRequest) {
  console.log('[save-scan] POST received');

  let imageDataUrl: string;
  let currentProfile: unknown = null;
  try {
    const body = await req.json();
    imageDataUrl = body.imageDataUrl;
    currentProfile = body.currentProfile ?? null;
    console.log('[save-scan] body parsed, imageDataUrl length:', imageDataUrl?.length ?? 'missing');
  } catch (err) {
    console.error('[save-scan] failed to parse request body:', err);
    return NextResponse.json({ ok: false, error: 'invalid JSON body', detail: String(err) }, { status: 400 });
  }

  if (!imageDataUrl) {
    console.error('[save-scan] imageDataUrl missing from body');
    return NextResponse.json({ ok: false, error: 'imageDataUrl is required' }, { status: 400 });
  }

  const base64 = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');
  console.log('[save-scan] buffer size:', buffer.length, 'bytes');

  // Save local copy for Python server
  try {
    await mkdir(join(process.cwd(), 'server', 'imgs'), { recursive: true });
    await writeFile(join(process.cwd(), 'server', 'imgs', 'scan.png'), buffer);
    console.log('[save-scan] local file saved');
  } catch (err) {
    console.error('[save-scan] failed to save local file (non-fatal):', err);
  }

  // Store session metadata in Convex
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await convex.mutation(api.sessions.create, {
      sessionId,
      currentProfile: currentProfile ?? undefined,
      imageUrl: imageDataUrl.slice(0, 200), // store just the prefix for reference
    });
    console.log('[save-scan] session stored in Convex, id:', sessionId);
  } catch (err) {
    console.error('[save-scan] Convex session insert failed (non-fatal):', err);
  }

  // Return the data URL directly so the client can display the scan photo
  console.log('[save-scan] done — sessionId:', sessionId);
  return NextResponse.json({ ok: true, sessionId, downloadUrl: imageDataUrl });
}
