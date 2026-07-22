import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: { response: null as unknown, session: { userId: 'user_1' } as unknown },
  rateLimited: null as unknown,
}));

vi.mock('@/lib/serverAuth', () => ({
  requireSignedIn: vi.fn(async () => mocks.auth),
}));
vi.mock('@/lib/durableRateLimit', () => ({
  enforceDurableRateLimits: vi.fn(async () => mocks.rateLimited),
}));

const { POST } = await import('./route');

const MODEL_HOST = 'generativelanguage.googleapis.com';

/** A minimal Linktree-shaped page for the happy path. */
function linktreeHtml(): string {
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: {
      pageProps: {
        account: {
          username: 'marcus',
          pageTitle: 'Marcus',
          description: 'Cuts on Telegraph Ave, Oakland · Tue–Sat 9–6 · fades $40.',
        },
        links: [{ title: 'Book', url: 'https://booksy.com/marcus' }],
      },
    },
  })}</script></body></html>`;
}

/** Route fetch by target: Linktree page vs. the extraction model endpoint. */
function stubFetch(opts: { html?: string; htmlStatus?: number; modelServices?: unknown } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const urlStr = String(input);
    if (urlStr.includes(MODEL_HOST)) {
      const content = JSON.stringify({
        location: 'Telegraph Ave, Oakland',
        hours: 'Tue–Sat · 9–6',
        services: opts.modelServices ?? [{ name: 'Fade', price: '$40' }],
      });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }
    return new Response(opts.html ?? linktreeHtml(), { status: opts.htmlStatus ?? 200 });
  });
}

function post(body: unknown): NextRequest {
  return new NextRequest('https://tryshapeup.cc/api/import-linktree', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.auth = { response: null, session: { userId: 'user_1' } };
  mocks.rateLimited = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('POST /api/import-linktree', () => {
  it('imports name, bio, links, and (with a key) LLM-extracted details', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const fetchMock = stubFetch();

    const res = await POST(post({ url: 'linktr.ee/marcus' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.displayName).toBe('Marcus');
    expect(data.links[0]).toMatchObject({ kind: 'booking', value: 'https://booksy.com/marcus' });
    expect(data.location).toBe('Telegraph Ave, Oakland');
    expect(data.hours).toBe('Tue–Sat · 9–6');
    expect(data.services).toEqual([{ name: 'Fade', price: '$40' }]);

    // It fetched the https-normalized Linktree URL and the model endpoint.
    const targets = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(targets).toContain('https://linktr.ee/marcus');
    expect(targets.some((t) => t.includes(MODEL_HOST))).toBe(true);
  });

  it('skips the LLM call and returns empty details when no key is configured', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const fetchMock = stubFetch();

    const res = await POST(post({ url: 'linktr.ee/marcus' }));
    const data = await res.json();
    expect(data.location).toBeUndefined();
    expect(data.services).toEqual([]);
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes(MODEL_HOST))).toBe(true);
  });

  it('still succeeds when the extraction model fails', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes(MODEL_HOST)) return new Response('boom', { status: 500 });
      return new Response(linktreeHtml(), { status: 200 });
    });

    const res = await POST(post({ url: 'linktr.ee/marcus' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.displayName).toBe('Marcus'); // scrape survives the model failure
    expect(data.services).toEqual([]);
  });

  it('rejects an unauthenticated request before fetching', async () => {
    mocks.auth = {
      response: new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 }),
      session: null,
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const res = await POST(post({ url: 'linktr.ee/marcus' }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('honors the rate limiter before fetching', async () => {
    mocks.rateLimited = new Response(JSON.stringify({ error: 'slow down' }), { status: 429 });
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const res = await POST(post({ url: 'linktr.ee/marcus' }));
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a missing URL without fetching', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const res = await POST(post({}));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-Linktree host (no open proxy) without fetching', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const res = await POST(post({ url: 'https://example.com/anything' }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a private/SSRF host without fetching', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const res = await POST(post({ url: 'http://127.0.0.1/admin' }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 422 when the page has nothing importable', async () => {
    stubFetch({ html: '<html><body>empty</body></html>' });
    const res = await POST(post({ url: 'linktr.ee/ghost' }));
    expect(res.status).toBe(422);
  });

  it('surfaces an upstream failure as a 502', async () => {
    stubFetch({ html: 'nope', htmlStatus: 404 });
    const res = await POST(post({ url: 'linktr.ee/missing' }));
    expect(res.status).toBe(502);
  });
});
