// ============================================================
// POST /api/edit — LLM Edit Loop endpoint
//
// Body: { system: string, message: string }
// Response: LLMEditResponse JSON
//
// Uses the image model's OpenAI-compatible endpoint (same quota as direct
// REST calls).
//
// ETHAN: set GEMINI_API_KEY in .env.local
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { EDIT_LOOP_SYSTEM_PROMPT } from '@/lib/llmPrompt';
import {
  buildDelimitedEditMessage,
  stripMarkdownJsonFences,
  validateLLMEditResponse,
  validatePromptLength,
} from '@/lib/llmValidation';
import { RATE_LIMITS, getClientIp, hashIdentifier } from '@/lib/rateLimit';
import { enforceDurableRateLimits } from '@/lib/durableRateLimit';
import { requireSignedIn } from '@/lib/serverAuth';

const IMAGE_MODEL_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

export async function POST(req: NextRequest) {
  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;

  const ip = getClientIp(req);
  const rateLimited = await enforceDurableRateLimits([
    { ...RATE_LIMITS.editUser, key: authResult.session.userId },
    { ...RATE_LIMITS.editIp, key: ip },
  ], authResult.session, {
    route: '/api/edit',
    user: hashIdentifier(authResult.session.userId),
    ip: hashIdentifier(ip),
  });
  if (rateLimited) return rateLimited;

  let body: { instruction?: unknown; currentProfile?: unknown; message?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const instruction = body.instruction;
  const promptError = validatePromptLength(instruction);
  if (promptError) {
    console.warn('[/api/edit] rejected prompt', {
      reason: 'invalid_length',
      user: hashIdentifier(authResult.session.userId),
    });
    return NextResponse.json({ error: promptError }, { status: 400 });
  }
  if (body.currentProfile == null) {
    return NextResponse.json({ error: 'Missing currentProfile' }, { status: 400 });
  }

  const message = buildDelimitedEditMessage(instruction as string, body.currentProfile);

  try {
    const response = await fetch(IMAGE_MODEL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GEMINI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gemini-2.5-flash-image',
        messages: [
          { role: 'system', content: EDIT_LOOP_SYSTEM_PROMPT },
          { role: 'user', content: message },
        ],
        max_tokens: 512,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[/api/edit] image model error:', err);
      return NextResponse.json({ error: 'LLM request failed' }, { status: 500 });
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
      console.warn('[/api/edit] rejected generation', {
        reason: 'missing_text',
        user: hashIdentifier(authResult.session.userId),
      });
      return NextResponse.json({ error: 'Malformed LLM response' }, { status: 422 });
    }

    // Strip any accidental markdown fences the model might add
    const jsonText = stripMarkdownJsonFences(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      console.warn('[/api/edit] rejected generation', {
        reason: 'parse_failed',
        user: hashIdentifier(authResult.session.userId),
      });
      return NextResponse.json({ error: 'Malformed LLM response' }, { status: 422 });
    }

    const validated = validateLLMEditResponse(parsed);
    if (!validated.ok) {
      console.warn('[/api/edit] rejected generation', {
        reason: validated.reason,
        user: hashIdentifier(authResult.session.userId),
      });
      return NextResponse.json({ error: 'Malformed LLM response' }, { status: 422 });
    }

    return NextResponse.json(validated.data);
  } catch (err) {
    console.error('[/api/edit]', err);
    return NextResponse.json({ error: 'LLM request failed' }, { status: 500 });
  }
}
