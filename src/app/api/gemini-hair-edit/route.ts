import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { db, storage } from '@/lib/firebase';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  console.log('\n[gemini-hair-edit] ===== POST START =====');
  console.log('[gemini-hair-edit] GEMINI_API_KEY set?', !!process.env.GEMINI_API_KEY);
  console.log('[gemini-hair-edit] GEMINI_API_KEY prefix:', process.env.GEMINI_API_KEY?.slice(0, 8) ?? 'MISSING');

  let imageUrl: string, prompt: string, sessionId: string;
  try {
    const body = await req.json();
    imageUrl = body.imageUrl;
    prompt = body.prompt;
    sessionId = body.sessionId;
    console.log('[gemini-hair-edit] body parsed OK');
    console.log('[gemini-hair-edit]   sessionId:', sessionId);
    console.log('[gemini-hair-edit]   prompt:', prompt);
    console.log('[gemini-hair-edit]   imageUrl (first 120):', imageUrl?.slice(0, 120) ?? 'MISSING');
  } catch (err) {
    console.error('[gemini-hair-edit] FAILED to parse request body:', err);
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!imageUrl || !prompt || !sessionId) {
    console.error('[gemini-hair-edit] missing fields — imageUrl:', !!imageUrl, '| prompt:', !!prompt, '| sessionId:', !!sessionId);
    return NextResponse.json({ ok: false, error: 'imageUrl, prompt, and sessionId are required' }, { status: 400 });
  }

  // --- Fetch source image ---
  let base64Image: string;
  let mimeType = 'image/png';
  try {
    console.log('[gemini-hair-edit] fetching source image...');
    const imageRes = await fetch(imageUrl);
    console.log('[gemini-hair-edit] image fetch status:', imageRes.status, imageRes.statusText);
    const contentType = imageRes.headers.get('content-type') ?? 'image/png';
    console.log('[gemini-hair-edit] image content-type:', contentType);
    if (contentType.includes('jpeg') || contentType.includes('jpg')) mimeType = 'image/jpeg';
    const arrayBuffer = await imageRes.arrayBuffer();
    base64Image = Buffer.from(arrayBuffer).toString('base64');
    console.log('[gemini-hair-edit] image converted to base64 — original bytes:', arrayBuffer.byteLength, '| base64 chars:', base64Image.length);
  } catch (err) {
    console.error('[gemini-hair-edit] FAILED to fetch/convert image:', err);
    return NextResponse.json({ ok: false, error: 'Failed to fetch image', detail: String(err) }, { status: 500 });
  }

  // --- Call Gemini ---
  let newImageBase64: string;
  const MODEL_NAME = 'gemini-3.1-flash-image-preview';
  try {
    console.log('[gemini-hair-edit] initializing Gemini model:', MODEL_NAME);
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      // @ts-expect-error responseModalities not yet in type defs
      generationConfig: { responseModalities: ['image', 'text'] },
    });

    const fullPrompt = `You are a professional hair stylist visualizer. Edit only the hair in this photo based on the following request: "${prompt}". Keep the face, skin, background, and all non-hair elements completely unchanged. Return the full edited portrait image.`;
    console.log('[gemini-hair-edit] full prompt:', fullPrompt);
    console.log('[gemini-hair-edit] sending request to Gemini...');

    const result = await model.generateContent([
      { inlineData: { mimeType, data: base64Image } },
      fullPrompt,
    ]);

    const elapsed = Date.now() - t0;
    console.log(`[gemini-hair-edit] Gemini responded in ${elapsed}ms`);

    const candidates = result.response.candidates ?? [];
    console.log('[gemini-hair-edit] candidates count:', candidates.length);

    if (candidates.length === 0) {
      console.error('[gemini-hair-edit] NO candidates returned!');
      console.error('[gemini-hair-edit] full response JSON:', JSON.stringify(result.response, null, 2));
      throw new Error('Gemini returned 0 candidates');
    }

    const candidate = candidates[0];
    console.log('[gemini-hair-edit] candidate[0] finishReason:', candidate.finishReason);
    console.log('[gemini-hair-edit] candidate[0] safetyRatings:', JSON.stringify(candidate.safetyRatings));

    const parts = candidate.content?.parts ?? [];
    console.log('[gemini-hair-edit] parts count:', parts.length);
    parts.forEach((p, i) => {
      if ('text' in p && p.text) {
        console.log(`[gemini-hair-edit] part[${i}] type=TEXT value:`, p.text.slice(0, 200));
      } else if ('inlineData' in p && p.inlineData) {
        console.log(`[gemini-hair-edit] part[${i}] type=IMAGE mimeType:`, p.inlineData.mimeType, '| data length:', (p.inlineData.data ?? '').length);
      } else {
        console.log(`[gemini-hair-edit] part[${i}] unknown shape:`, JSON.stringify(p).slice(0, 100));
      }
    });

    const imagePart = parts.find((p: { inlineData?: { data: string } }) => p.inlineData?.data);
    if (!imagePart?.inlineData?.data) {
      console.error('[gemini-hair-edit] NO image part in response! Full response:');
      console.error(JSON.stringify(result.response, null, 2));
      throw new Error('Gemini returned no image — see server logs for full response');
    }
    newImageBase64 = imagePart.inlineData.data;
    console.log('[gemini-hair-edit] extracted image base64 length:', newImageBase64.length);
  } catch (err) {
    console.error('[gemini-hair-edit] Gemini generation THREW:', err);
    console.error('[gemini-hair-edit] error type:', (err as Error)?.constructor?.name);
    console.error('[gemini-hair-edit] error message:', (err as Error)?.message);
    return NextResponse.json({ ok: false, error: 'Gemini generation failed', detail: String(err) }, { status: 500 });
  }

  // --- Upload to Firebase Storage ---
  let newImageUrl: string;
  try {
    const storagePath = `scans/${sessionId}/scan_${Date.now()}.png`;
    console.log('[gemini-hair-edit] uploading to Firebase Storage:', storagePath);
    const buffer = Buffer.from(newImageBase64, 'base64');
    console.log('[gemini-hair-edit] upload buffer size:', buffer.length, 'bytes');
    const storageRef = ref(storage, storagePath);
    const snapshot = await uploadBytes(storageRef, buffer, { contentType: 'image/png' });
    newImageUrl = await getDownloadURL(snapshot.ref);
    console.log('[gemini-hair-edit] Firebase upload done — newImageUrl:', newImageUrl.slice(0, 120));
  } catch (err) {
    console.error('[gemini-hair-edit] Firebase Storage upload FAILED:', err);
    return NextResponse.json({ ok: false, error: 'Firebase Storage upload failed', detail: String(err) }, { status: 500 });
  }

  // --- Append to Firestore session ---
  try {
    console.log('[gemini-hair-edit] appending to Firestore session.images, sessionId:', sessionId);
    await updateDoc(doc(db, 'session', sessionId), { images: arrayUnion(newImageUrl) });
    console.log('[gemini-hair-edit] Firestore updated OK');
  } catch (err) {
    console.error('[gemini-hair-edit] Firestore update FAILED (non-fatal):', err);
  }

  const totalMs = Date.now() - t0;
  console.log(`[gemini-hair-edit] ===== POST END — total ${totalMs}ms — returning newImageUrl =====\n`);
  return NextResponse.json({ ok: true, newImageUrl });
}
