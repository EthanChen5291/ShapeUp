// POST { imageDataUrl?: string, imageUrl?: string, sessionId: string }
//   → { ok: true, plyUrl: string }
// Accepts either a base64 data URL or a plain HTTPS image URL (fetched server-side).
// Returns the Firebase Storage URL of the uploaded PLY.

import { NextRequest, NextResponse } from 'next/server';
import { db, storage } from '@/lib/firebase';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const HAIRSTEP_URL = process.env.HAIRSTEP_URL ?? '';

export async function POST(req: NextRequest) {
  if (!HAIRSTEP_URL) {
    console.error('[hairstep] POST: HAIRSTEP_URL not configured');
    return NextResponse.json({ error: 'HAIRSTEP_URL not configured' }, { status: 503 });
  }

  const body = await req.json();
  const { imageDataUrl, imageUrl, sessionId, currentProfile } = body as {
    imageDataUrl?: string;
    imageUrl?: string;
    sessionId: string;
    currentProfile?: unknown;
  };

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  let buffer: Buffer;

  if (imageUrl) {
    console.log(`[hairstep] POST: fetching image from URL (${imageUrl.slice(0, 80)}…)`);
    const res = await fetch(imageUrl);
    if (!res.ok) {
      console.error(`[hairstep] POST: image fetch failed ${res.status}`);
      return NextResponse.json({ error: `Failed to fetch image: ${res.status}` }, { status: 502 });
    }
    buffer = Buffer.from(await res.arrayBuffer());
    console.log(`[hairstep] POST: fetched image (${buffer.length} bytes)`);
  } else if (imageDataUrl && imageDataUrl.startsWith('data:image')) {
    const base64 = imageDataUrl.split(',')[1];
    buffer = Buffer.from(base64, 'base64');
    console.log(`[hairstep] POST: decoded imageDataUrl (${buffer.length} bytes)`);
  } else {
    return NextResponse.json({ error: 'imageDataUrl or imageUrl is required' }, { status: 400 });
  }

  const blob = new Blob([new Uint8Array(buffer)], { type: 'image/png' });
  const form = new FormData();
  form.append('png', blob, 'face.png');
  if (currentProfile != null) {
    form.append('current_profile_json', JSON.stringify(currentProfile));
  }

  console.log(`[hairstep] POST: sending to ${HAIRSTEP_URL}`);
  const upstream = await fetch(`${HAIRSTEP_URL}`, {
    method:  'POST',
    headers: { 'ngrok-skip-browser-warning': 'true' },
    body:    form,
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    console.error(`[hairstep] POST: upstream error ${upstream.status}: ${text.slice(0, 300)}`);
    return NextResponse.json({ error: `HairStep server error: ${text}` }, { status: 502 });
  }

  const plyBuffer = Buffer.from(await upstream.arrayBuffer());
  console.log(`[hairstep] POST: received PLY (${plyBuffer.length} bytes)`);

  console.log(`[hairstep] POST: uploading PLY to Firebase Storage (scans/${sessionId}/hairstep.ply)`);
  const storageRef = ref(storage, `scans/${sessionId}/hairstep.ply`);
  const snapshot   = await uploadBytes(storageRef, plyBuffer, { contentType: 'application/octet-stream' });
  const plyUrl     = await getDownloadURL(snapshot.ref);
  console.log(`[hairstep] POST: uploaded PLY, url: ${plyUrl.slice(0, 80)}…`);

  try {
    await updateDoc(doc(db, 'session', sessionId), {
      hair_plys: arrayUnion(plyUrl),
      currentProfile: currentProfile ?? null,
    });
    console.log(`[hairstep] POST: appended PLY url to session.hair_plys`);
  } catch (err) {
    console.error('[hairstep] POST: Firestore update failed (non-fatal):', err);
  }

  return NextResponse.json({ ok: true, plyUrl });
}

export async function GET(req: NextRequest) {
  if (!HAIRSTEP_URL) {
    return NextResponse.json({ error: 'HAIRSTEP_URL not configured' }, { status: 503 });
  }

  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
  }

  const upstream = await fetch(`${HAIRSTEP_URL}/status/${jobId}`, {
    headers: { 'ngrok-skip-browser-warning': 'true', 'User-Agent': 'shapeup' },
  });

  const data = await upstream.json();
  return NextResponse.json(data);
}
