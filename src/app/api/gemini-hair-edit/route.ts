import { NextRequest, NextResponse } from 'next/server';
import {
  HairEditError,
  MAX_IMAGE_EDIT_PROMPT_LENGTH,
  runHairEdit,
} from '@/lib/geminiHairEdit';
import { enforceDurableRateLimits } from '@/lib/durableRateLimit';
import { recordImageEditUsage } from '@/lib/imageEditUsage';
import { getClientIp, hashIdentifier, RATE_LIMITS } from '@/lib/rateLimit';
import { requireSignedIn } from '@/lib/serverAuth';

export async function POST(req: NextRequest) {
  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;

  const ip = getClientIp(req);
  const rateLimited = await enforceDurableRateLimits(
    [
      { ...RATE_LIMITS.summaryUser, key: authResult.session.userId },
      { ...RATE_LIMITS.summaryIp, key: ip },
    ],
    authResult.session,
    {
      route: '/api/gemini-hair-edit',
      user: hashIdentifier(authResult.session.userId),
      ip: hashIdentifier(ip),
    },
  );
  if (rateLimited) return rateLimited;

  let imageUrl: unknown;
  let prompt: unknown;
  let currentProfile: unknown = null;
  let referenceImageDataUrl: unknown;
  try {
    const body = await req.json() as Record<string, unknown>;
    imageUrl = body.imageUrl;
    prompt = body.prompt;
    currentProfile = body.currentProfile ?? null;
    referenceImageDataUrl = body.referenceImageDataUrl;
  } catch (error) {
    console.error('[image-edit-route] failed to parse request body', error);
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!imageUrl || !prompt) {
    return NextResponse.json(
      { ok: false, error: 'imageUrl and prompt are required' },
      { status: 400 },
    );
  }
  if (typeof prompt !== 'string' || prompt.length > MAX_IMAGE_EDIT_PROMPT_LENGTH) {
    return NextResponse.json(
      {
        ok: false,
        error: `prompt must be a string of at most ${MAX_IMAGE_EDIT_PROMPT_LENGTH} characters`,
      },
      { status: 400 },
    );
  }
  if (typeof imageUrl !== 'string') {
    return NextResponse.json({ ok: false, error: 'imageUrl is not allowed' }, { status: 400 });
  }

  try {
    const result = await runHairEdit({
      imageUrl,
      prompt,
      currentProfile,
      referenceImageDataUrl,
      requestUrl: req.url,
      requestHeaders: req.headers,
      onEditComplete: () => recordImageEditUsage(authResult.session),
    });
    return NextResponse.json({
      ok: true,
      newImageUrl: result.newImageUrl,
      editReport: result.editReport,
    });
  } catch (error) {
    if (error instanceof HairEditError) {
      const publicMessage = error.publicMessage;
      return NextResponse.json(
        {
          ok: false,
          error: publicMessage,
          ...(error.detail ? { detail: error.detail } : {}),
        },
        { status: error.status },
      );
    }
    console.error('[image-edit-route] unexpected failure', error);
    return NextResponse.json(
      { ok: false, error: 'Image generation failed', detail: String(error) },
      { status: 500 },
    );
  }
}
