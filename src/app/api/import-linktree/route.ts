// POST { url } → { displayName?, bio?, location?, hours?, services?, links[] }
// scraped (and, for the free-text fields, model-extracted) from a public
// Linktree.
//
// The card builder calls this to prefill from a barber's existing link-in-bio.
// We fetch server-side (the browser can't — cross-origin) behind these guards:
//   1. requireSignedIn + durable rate limits, because a press can trigger an LLM
//      call (cost) — same posture as /api/summary.
//   2. parseSafeRemoteUrl blocks SSRF (private hosts / non-http schemes).
//   3. isSupportedImportHost restricts us to Linktree, so this can't be turned
//      into a general-purpose "fetch any URL through our server" endpoint.
// Parsing/extraction live in pure, unit-tested libs; this route is the policy
// (auth, rate limit, fetch) around them.

import { NextRequest, NextResponse } from 'next/server';
import { parseSafeRemoteUrl } from '@/lib/urlSafety';
import { isSupportedImportHost, parseLinktreeHtml } from '@/lib/linktreeImport';
import {
  EMPTY_BIO_DETAILS,
  buildBioExtractionMessages,
  parseBioDetails,
  type BioDetails,
} from '@/lib/bioExtraction';
import { RATE_LIMITS, getClientIp, hashIdentifier } from '@/lib/rateLimit';
import { enforceDurableRateLimits } from '@/lib/durableRateLimit';
import { requireSignedIn } from '@/lib/serverAuth';

export const runtime = 'nodejs';

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 4 * 1024 * 1024; // Linktree pages are well under this.

// Gemini via the OpenAI-compatible endpoint — same wiring as /api/summary.
const MODEL_API_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const MODEL_NAME = 'gemini-2.5-flash-image';
const EXTRACT_TIMEOUT_MS = 9000;

/**
 * Best-effort: pull location/hours/services out of the bio prose. Any failure
 * (no key, model error, timeout, junk output) degrades to empty details — the
 * scrape result is what matters; these fields are a bonus.
 */
async function extractBioDetails(bio: string): Promise<BioDetails> {
  if (!bio.trim() || !process.env.GEMINI_API_KEY) return EMPTY_BIO_DETAILS;

  const { system, user } = buildBioExtractionMessages(bio);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);
  try {
    const res = await fetch(MODEL_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GEMINI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: 512,
        temperature: 0, // Extraction, not writing — don't let it get creative.
      }),
    });
    if (!res.ok) {
      console.warn('[/api/import-linktree] bio extraction model error', res.status);
      return EMPTY_BIO_DETAILS;
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? parseBioDetails(content) : EMPTY_BIO_DETAILS;
  } catch {
    return EMPTY_BIO_DETAILS;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;

  const ip = getClientIp(req);
  const rateLimited = await enforceDurableRateLimits(
    [
      { ...RATE_LIMITS.importUser, key: authResult.session.userId },
      { ...RATE_LIMITS.importIp, key: ip },
    ],
    authResult.session,
    {
      route: '/api/import-linktree',
      user: hashIdentifier(authResult.session.userId),
      ip: hashIdentifier(ip),
    },
  );
  if (rateLimited) return rateLimited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const rawUrl =
    typeof body === 'object' && body !== null && typeof (body as { url?: unknown }).url === 'string'
      ? (body as { url: string }).url.trim()
      : '';
  if (!rawUrl) {
    return NextResponse.json({ error: 'Add a Linktree URL to import.' }, { status: 400 });
  }

  const withScheme = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const safe = parseSafeRemoteUrl(withScheme);
  if (!safe) {
    return NextResponse.json({ error: "That doesn't look like a valid link." }, { status: 400 });
  }
  if (!isSupportedImportHost(safe.hostname)) {
    return NextResponse.json(
      { error: 'Only Linktree links can be imported right now.' },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let html: string;
  try {
    const res = await fetch(safe.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Linktree serves the __NEXT_DATA__ blob to normal browsers; a bare
        // fetch UA sometimes gets a stripped page.
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html',
      },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Couldn't load that page (${res.status}). Check the link and try again.` },
        { status: 502 },
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_HTML_BYTES) {
      return NextResponse.json({ error: 'That page was too large to import.' }, { status: 502 });
    }
    html = buf.toString('utf8');
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return NextResponse.json(
      { error: aborted ? 'That page took too long to load.' : "Couldn't reach that page." },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }

  const parsed = parseLinktreeHtml(html);
  if (!parsed.displayName && !parsed.bio && parsed.links.length === 0) {
    return NextResponse.json(
      { error: "Couldn't find anything to import on that page." },
      { status: 422 },
    );
  }

  // Bonus round: read location/hours/services out of the bio prose, if any.
  const details = parsed.bio ? await extractBioDetails(parsed.bio) : EMPTY_BIO_DETAILS;

  return NextResponse.json({
    ...parsed,
    location: details.location,
    hours: details.hours,
    services: details.services,
  });
}
