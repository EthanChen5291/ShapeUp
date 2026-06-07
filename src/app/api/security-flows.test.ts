import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { promisify } from 'node:util';

describe('Stripe checkout route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/serverAuth');
    vi.unstubAllEnvs();
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123');
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://shapeup.test');
  });

  test('includes authenticated Clerk metadata so the webhook can grant credits', async () => {
    const createCheckoutSession = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.test/session' });
    vi.doMock('stripe', () => ({
      default: vi.fn(function Stripe() {
        return {
          checkout: { sessions: { create: createCheckoutSession } },
        };
      }),
    }));
    vi.doMock('@/lib/serverAuth', () => ({
      requireSignedIn: vi.fn().mockResolvedValue({
        response: null,
        session: { userId: 'user_123' },
      }),
    }));

    const { POST } = await import('./stripe/checkout/route');

    const res = await POST(new Request('https://shapeup.test/api/stripe/checkout', {
      method: 'POST',
      body: JSON.stringify({ plan: 'starter' }),
    }));

    expect(res.status).toBe(200);
    expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        clerkId: 'user_123',
        plan: 'starter',
        credits: '20',
      }),
    }));
  });
});

describe('admin APIs', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/serverAuth');
    vi.unstubAllEnvs();
    vi.stubEnv('AWS_REGION', 'us-east-1');
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
    vi.stubEnv('AWS_S3_BUCKET_NAME', 'shapeup-test');
  });

  test('/api/admin-s3 rejects unauthenticated callers before listing private S3 data', async () => {
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn(function S3Client() {
        return {
          send: vi.fn().mockResolvedValue({
            Contents: [{
              Key: 'pictures/session_123/scan.png',
              LastModified: new Date('2026-01-01T00:00:00Z'),
              Size: 42,
            }],
          }),
        };
      }),
      ListObjectsV2Command: vi.fn(function ListObjectsV2Command(input) {
        return input;
      }),
      GetObjectCommand: vi.fn(function GetObjectCommand(input) {
        return input;
      }),
    }));
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn().mockResolvedValue('https://signed.example/scan.png'),
    }));

    const { GET } = await import('./admin-s3/route');
    const res = await GET(new Request('https://shapeup.test/api/admin-s3?section=images'));

    expect([401, 403]).toContain(res.status);
  });

  test('/api/admin-sessions rejects unauthenticated callers before returning sessions', async () => {
    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: vi.fn(function ConvexHttpClient() {
        return {
          query: vi.fn().mockResolvedValue([{ sessionId: 'session_123' }]),
        };
      }),
    }));

    const { GET } = await import('./admin-sessions/route');
    const res = await GET();

    expect([401, 403]).toContain(res.status);
  });
});

describe('scan and generation APIs', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/serverAuth');
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', 'https://convex.test');
  });

  test('/api/save-scan rejects unauthenticated callers instead of creating public scan sessions', async () => {
    vi.doMock('@/lib/s3', () => ({
      uploadToS3: vi.fn().mockResolvedValue(undefined),
      getSignedDownloadUrl: vi.fn().mockResolvedValue('https://signed.example/scan.png'),
    }));
    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: vi.fn(function ConvexHttpClient() {
        return {
          mutation: vi.fn().mockResolvedValue('session_doc'),
        };
      }),
    }));

    const { POST } = await import('./save-scan/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/save-scan', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl: 'data:image/png;base64,AAAA' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect([401, 403]).toContain(res.status);
  });

  test('/api/facelift validates the image before deducting a credit', async () => {
    const deductCredit = vi.fn().mockResolvedValue(0);
    vi.stubEnv('FACELIFT_URL', 'https://ml.shapeup.test');
    vi.doMock('@clerk/nextjs/server', () => ({
      auth: vi.fn().mockResolvedValue({
        userId: 'user_123',
        getToken: vi.fn().mockResolvedValue('convex.jwt'),
      }),
    }));
    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: vi.fn(function ConvexHttpClient() {
        return {
          setAuth: vi.fn(),
          mutation: deductCredit,
        };
      }),
    }));
    vi.doMock('@/lib/s3', () => ({
      uploadToS3: vi.fn(),
      getSignedDownloadUrl: vi.fn(),
    }));

    const { POST } = await import('./facelift/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/facelift', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl: 'not-an-image' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(400);
    expect(deductCredit.mock.calls.length).toBe(0);
  });

  test('/api/proxy-ply rejects arbitrary private-network URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ply', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('./proxy-ply/route');
    const res = await GET(new NextRequest('https://shapeup.test/api/proxy-ply?url=http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data'));

    expect([400, 403]).toContain(res.status);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('/api/gemini-hair-edit rejects arbitrary image URLs before server-side fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('GEMINI_API_KEY', 'gemini-test');
    vi.doMock('@google/generative-ai', () => ({
      HarmCategory: {
        HARM_CATEGORY_HARASSMENT: 'harassment',
        HARM_CATEGORY_HATE_SPEECH: 'hate_speech',
        HARM_CATEGORY_SEXUALLY_EXPLICIT: 'sex',
        HARM_CATEGORY_DANGEROUS_CONTENT: 'danger',
      },
      HarmBlockThreshold: { BLOCK_ONLY_HIGH: 'high' },
      GoogleGenerativeAI: vi.fn(function GoogleGenerativeAI() {
        return {
          getGenerativeModel: vi.fn(() => ({
            generateContent: vi.fn().mockResolvedValue({
              response: {
                candidates: [{
                  finishReason: 'STOP',
                  content: { parts: [{ inlineData: { data: 'AAAA', mimeType: 'image/png' } }] },
                }],
              },
            }),
          })),
        };
      }),
    }));

    const { POST } = await import('./gemini-hair-edit/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/gemini-hair-edit', {
      method: 'POST',
      body: JSON.stringify({
        imageUrl: 'http://169.254.169.254/latest/meta-data',
        prompt: 'short crop',
        sessionId: 'session_123',
      }),
      headers: { 'content-type': 'application/json' },
    }));

    expect([400, 403]).toContain(res.status);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('local file editing API', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('/api/edit-hair-measurements validates numeric deltas before invoking a shell command', async () => {
    const execMock = vi.fn((_cmd, _opts, cb) => cb(null, '{}', ''));
    Object.assign(execMock, {
      [promisify.custom]: vi.fn().mockResolvedValue({ stdout: '{}', stderr: '' }),
    });
    vi.doMock('child_process', () => ({ exec: execMock }));
    vi.doMock('fs', () => ({
      default: {
        existsSync: vi.fn().mockReturnValue(true),
        readFileSync: vi.fn().mockReturnValue('{}'),
      },
    }));

    const { POST } = await import('./edit-hair-measurements/route');
    const res = await POST(new NextRequest('https://shapeup.test/api/edit-hair-measurements', {
      method: 'POST',
      body: JSON.stringify({
        deltas: { backLength: '$(touch /tmp/shapeup-pwned)' },
      }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(400);
    expect(execMock).not.toHaveBeenCalled();
  });
});
