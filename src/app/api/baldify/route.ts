import { NextRequest, NextResponse } from 'next/server';

const PROMPT = `Remove all scalp hair from this person so they appear completely bald.

Render the scalp as smooth, natural skin — matching the exact skin tone, texture, and lighting of the face. Preserve the natural skull contour implied by the existing hairline and head shape.

Do NOT change anything else. Keep identical:
- facial features, expression, and proportions
- skin tone and texture on the face
- eyebrows and any facial hair (beard, stubble, mustache)
- ears, neck, shoulders
- pose, camera angle, framing
- lighting direction, shadows, and color grading
- background

Output must be photorealistic. No stylization, no hats, no head coverings, no added hair. Match the original photo's resolution and quality.`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 503 });
  }

  const body = await req.json();
  const currentProfile = body.currentProfile ?? null;
  let mimeType: string;
  let base64: string;

  if (typeof body.imageDataUrl === 'string' && body.imageDataUrl.startsWith('data:image')) {
    const [header, b64] = body.imageDataUrl.split(',');
    mimeType = header.match(/data:([^;]+)/)?.[1] ?? 'image/jpeg';
    base64 = b64;
  } else if (typeof body.imageUrl === 'string') {
    const imgRes = await fetch(body.imageUrl);
    if (!imgRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch imageUrl' }, { status: 400 });
    }
    mimeType = imgRes.headers.get('content-type') ?? 'image/jpeg';
    const buf = await imgRes.arrayBuffer();
    base64 = Buffer.from(buf).toString('base64');
  } else {
    return NextResponse.json({ error: 'Provide imageDataUrl or imageUrl' }, { status: 400 });
  }

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inlineData: { mimeType, data: base64 } },
              {
                text: currentProfile == null
                  ? PROMPT
                  : `${PROMPT}\n\nCURRENT_PROFILE: ${JSON.stringify(currentProfile, null, 2)}`,
              },
            ],
          },
        ],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
      }),
    }
  );

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    console.error('[/api/baldify] Gemini error', upstream.status, text);
    return NextResponse.json({ error: `Gemini error: ${text}` }, { status: 502 });
  }

  const data = await upstream.json();

  for (const part of data.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData) {
      const { mimeType: outMime, data: outData } = part.inlineData;
      return NextResponse.json({ baldifiedDataUrl: `data:${outMime};base64,${outData}` });
    }
  }

  return NextResponse.json({ error: 'Gemini returned no image' }, { status: 500 });
}
