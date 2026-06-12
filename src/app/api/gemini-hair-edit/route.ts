import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { isSafeImageSource } from '@/lib/urlSafety';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  console.log('\n[gemini-hair-edit] ===== POST START =====');
  console.log('[gemini-hair-edit] GEMINI_API_KEY set?', !!process.env.GEMINI_API_KEY);

  let imageUrl: string, prompt: string, sessionId: string;
  let currentProfile: unknown = null;
  try {
    const body = await req.json();
    imageUrl = body.imageUrl;
    prompt = body.prompt;
    sessionId = body.sessionId;
    currentProfile = body.currentProfile ?? null;
    console.log('[gemini-hair-edit] body parsed OK');
    console.log('[gemini-hair-edit]   sessionId:', sessionId);
    console.log('[gemini-hair-edit]   prompt:', prompt);
    console.log('[gemini-hair-edit]   imageUrl (first 120):', imageUrl?.slice(0, 120) ?? 'MISSING');
    console.log('[gemini-hair-edit]   currentProfile present:', currentProfile !== null);
  } catch (err) {
    console.error('[gemini-hair-edit] FAILED to parse request body:', err);
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!imageUrl || !prompt || !sessionId) {
    console.error('[gemini-hair-edit] missing fields — imageUrl:', !!imageUrl, '| prompt:', !!prompt, '| sessionId:', !!sessionId);
    return NextResponse.json({ ok: false, error: 'imageUrl, prompt, and sessionId are required' }, { status: 400 });
  }
  if (!isSafeImageSource(imageUrl)) {
    return NextResponse.json({ ok: false, error: 'imageUrl is not allowed' }, { status: 400 });
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
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
      safetySettings,
    });

    const fullPrompt = `ROLE
You are ShapeUp's master-barber visualizer. You produce photorealistic haircut previews that look like the same photo of the same person, taken minutes after a real cut.

CLIENT REQUEST: "${prompt}"

WHAT TO CHANGE — hair only
- Cut, length, shape, texture, hairline edges, and color ONLY if explicitly requested.
- Interpret the request the way an experienced barber would, in real barbershop terms:
  * "fade" = graduated clipper work on sides/back, shortest at the bottom; "taper" = tighter version at the edges only.
  * "texture"/"messy" = visible separation and movement in the lengths — never noise or frizz.
  * Respect the client's natural curl pattern, density, and hairline visible in the photo; a style lands differently on coily 4B hair than on straight 1B hair, and the result must show that.
- If the request is ambiguous, choose the conservative, most-asked-for barbershop interpretation.

HARD CONSTRAINTS — must not change
- Face geometry, skin, expression, eyes, eyebrows, ears, neck, facial hair (unless asked).
- Camera angle, framing, crop, background, lighting, white balance.
- Photographic character: same realism, same grain. No beautification, no stylization, no cartoon drift.

QUALITY BAR
- The new hairline must sit naturally on the existing forehead. No helmet edges, no floating strands, no pasted-on look.
- Hair must cast and receive light consistently with the original photo.

CLIENT GEOMETRY (current 3D hair measurements — use to scale the cut believably):
${JSON.stringify(currentProfile)}

Return ONLY the edited image.`;
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
      const promptFeedback = (result.response as { promptFeedback?: { blockReason?: string } }).promptFeedback;
      if (promptFeedback?.blockReason) {
        return NextResponse.json({ ok: false, error: 'This image or edit request was blocked by content safety filters. Try a different photo or prompt.' }, { status: 422 });
      }
      throw new Error('Gemini returned 0 candidates');
    }

    const candidate = candidates[0];
    console.log('[gemini-hair-edit] candidate[0] finishReason:', candidate.finishReason);
    console.log('[gemini-hair-edit] candidate[0] safetyRatings:', JSON.stringify(candidate.safetyRatings));

    if (candidate.finishReason === 'SAFETY') {
      console.error('[gemini-hair-edit] blocked by safety filters — safetyRatings:', JSON.stringify(candidate.safetyRatings));
      return NextResponse.json({ ok: false, error: 'This image or edit request was blocked by content safety filters. Try a different photo or prompt.' }, { status: 422 });
    }

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

  const newImageUrl = `data:image/png;base64,${newImageBase64}`;

  const totalMs = Date.now() - t0;
  console.log(`[gemini-hair-edit] ===== POST END — total ${totalMs}ms =====\n`);
  return NextResponse.json({ ok: true, newImageUrl });
}
