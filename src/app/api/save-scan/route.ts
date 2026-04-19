import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { db, storage } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export async function POST(req: NextRequest) {
  console.log('[save-scan] POST received');

  let imageDataUrl: string;
  let currentProfile: unknown = null;
  try {
    const body = await req.json();
    imageDataUrl = body.imageDataUrl;
    currentProfile = body.currentProfile ?? null;
    console.log('[save-scan] body parsed, imageDataUrl length:', imageDataUrl?.length ?? 'missing');
    console.log('[save-scan] currentProfile present:', currentProfile !== null);
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
  const savePath = join(process.cwd(), 'server', 'imgs', 'scan.png');
  try {
    await mkdir(join(process.cwd(), 'server', 'imgs'), { recursive: true });
    await writeFile(savePath, buffer);
    console.log('[save-scan] local file saved to', savePath);
  } catch (err) {
    console.error('[save-scan] failed to save local file:', err);
    // Non-fatal — continue with Firebase upload
  }

  let downloadUrl: string | null = null;
  let sessionId: string | null = null;

  // Generate a session ID first so we can use it in the storage path
  let pendingSessionId: string | null = null;
  try {
    const sessionRef = await addDoc(collection(db, 'session'), {
      createdAt: serverTimestamp(),
      currentProfile,
    });
    pendingSessionId = sessionRef.id;
  } catch (err) {
    console.error('[save-scan] Firestore pre-create failed (non-fatal):', err);
    pendingSessionId = `local_${Date.now()}`;
  }

  try {
    const storageRef = ref(storage, `scans/${pendingSessionId}/scan_${Date.now()}.png`);
    console.log('[save-scan] uploading to Firebase Storage...');
    const snapshot = await uploadBytes(storageRef, buffer, { contentType: 'image/png' });
    downloadUrl = await getDownloadURL(snapshot.ref);
    console.log('[save-scan] uploaded, downloadUrl:', downloadUrl);
  } catch (err) {
    console.error('[save-scan] Firebase Storage upload failed (non-fatal):', err);
  }

  if (downloadUrl && pendingSessionId && !pendingSessionId.startsWith('local_')) {
    try {
      const { doc, updateDoc, arrayUnion } = await import('firebase/firestore');
      await updateDoc(doc(db, 'session', pendingSessionId), {
        images: arrayUnion(downloadUrl),
        currentProfile,
      });
      sessionId = pendingSessionId;
      console.log('[save-scan] Firestore doc updated with images array, id:', sessionId);
    } catch (err) {
      console.error('[save-scan] Firestore update failed (non-fatal):', err);
      sessionId = pendingSessionId;
    }
  } else {
    sessionId = pendingSessionId;
  }

  console.log('[save-scan] done — sessionId:', sessionId, 'downloadUrl:', downloadUrl);
  return NextResponse.json({ ok: true, sessionId, downloadUrl });
}
