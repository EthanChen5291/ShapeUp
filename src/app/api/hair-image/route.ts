import { NextRequest, NextResponse } from 'next/server';
import { readFile, writeFile } from 'fs/promises';

import { join } from 'path';

export async function POST(req: NextRequest) {
  const { feedback } = await req.json();

  const imgBuffer = await readFile(join(process.cwd(), 'server', 'imgs', 'scan.jpg'));
  const base64 = imgBuffer.toString('base64');
  const mimeType = 'image/jpeg';

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: `Edit this person's hairstyle: ${feedback}. Keep the face identical, only change the hair.` },
          ],
        }],
        generationConfig: { responseModalities: ['Text', 'Image'] },
      }),
    }
  );

  const data = await res.json();
  console.log('[hair-image] image model response:', JSON.stringify(data, null, 2));
  const imgData = data.candidates?.[0]?.content?.parts?.find((p: any) => p.inline_data)?.inline_data;
  if (!imgData) return NextResponse.json({ error: 'No image returned', detail: data }, { status: 500 });

  await writeFile(
    join(process.cwd(), 'server', 'imgs', 'generated.jpg'),
    Buffer.from(imgData.data, 'base64'),
  );

  return NextResponse.json({ imageDataUrl: `data:${imgData.mime_type};base64,${imgData.data}` });
}
