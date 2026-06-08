// ============================================================
// POST /api/summary — Output Phase endpoint
//
// Body: { profile: UserHeadProfile, params: HairParams }
// Response: { summary: string }
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { MAX_SUMMARY_PAYLOAD_LENGTH } from '@/lib/llmValidation';
import { RATE_LIMITS, enforceRateLimits, getClientIp, hashIdentifier } from '@/lib/rateLimit';
import { requireSignedIn } from '@/lib/serverAuth';

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

export async function POST(req: NextRequest) {
  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;

  const ip = getClientIp(req);
  const rateLimited = enforceRateLimits([
    { ...RATE_LIMITS.summaryUser, key: authResult.session.userId },
    { ...RATE_LIMITS.summaryIp, key: ip },
  ], {
    route: '/api/summary',
    user: hashIdentifier(authResult.session.userId),
    ip: hashIdentifier(ip),
  });
  if (rateLimited) return rateLimited;

  let body: { profile?: unknown; params?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { profile, params } = body;

  if (!profile || !params) {
    return NextResponse.json({ error: 'Missing profile or params' }, { status: 400 });
  }
  const payloadLength = JSON.stringify({ profile, params }).length;
  if (payloadLength > MAX_SUMMARY_PAYLOAD_LENGTH) {
    console.warn('[/api/summary] rejected payload', {
      reason: 'oversized',
      user: hashIdentifier(authResult.session.userId),
    });
    return NextResponse.json({ error: 'Summary payload is too large' }, { status: 400 });
  }

  const typedProfile = profile as { currentStyle?: { hairType?: unknown; preset?: unknown } };
  const typedParams = params as Record<string, unknown>;
  const hairType = typeof typedProfile.currentStyle?.hairType === 'string' ? typedProfile.currentStyle.hairType : 'unknown';
  const preset = typeof typedProfile.currentStyle?.preset === 'string' ? typedProfile.currentStyle.preset : 'default';
  const numberOrZero = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;

  const system = `You are a professional barber assistant. Given a client's hair profile and desired style parameters, write a concise barber instruction card. Output 5–8 bullet points a barber can follow. Be specific with lengths, techniques, and product suggestions. Do NOT use markdown headers — just bullet points starting with "•".`;

  const message = `Client profile:
- Hair type: ${hairType}
- Current preset: ${preset}

Desired style parameters (0.0 = none, 2.0 = maximum for lengths; 0.0–1.0 for others):
- Top length: ${numberOrZero(typedParams.topLength).toFixed(2)}
- Side length: ${numberOrZero(typedParams.sideLength).toFixed(2)}
- Back length: ${numberOrZero(typedParams.backLength).toFixed(2)}
- Messiness/texture: ${numberOrZero(typedParams.messiness).toFixed(2)}
- Taper: ${numberOrZero(typedParams.taper).toFixed(2)}

Write the barber instruction card now.`;

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GEMINI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gemini-2.5-flash-image',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: message },
        ],
        max_tokens: 512,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[/api/summary] Gemini error:', err);
      return NextResponse.json({ error: 'LLM request failed' }, { status: 500 });
    }

    const data = await response.json();
    const summary = data.choices[0].message.content as string;

    return NextResponse.json({ summary });
  } catch (err) {
    console.error('[/api/summary]', err);
    return NextResponse.json({ error: 'Summary request failed' }, { status: 500 });
  }
}
