import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  configured: true,
  query: vi.fn(),
  createPass: vi.fn(),
}));

vi.mock('convex/browser', () => ({
  ConvexHttpClient: vi.fn(function ConvexHttpClient() {
    return { query: mocks.query };
  }),
}));

vi.mock('@convex/_generated/api', () => ({
  api: { barberPages: { getBySlug: 'barberPages:getBySlug' } },
}));

vi.mock('@/lib/appleWallet', () => ({
  isAppleWalletConfigured: () => mocks.configured,
  createBarberWalletPass: mocks.createPass,
}));

const { GET } = await import('./route');

beforeEach(() => {
  mocks.configured = true;
  mocks.query.mockResolvedValue({
    slug: 'marcus',
    displayName: 'Marcus Rivera',
    links: [],
  });
  mocks.createPass.mockResolvedValue(Buffer.from('signed-pass'));
  vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', 'https://convex.example');
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://tryshapeup.cc/');
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('GET /api/barber/[slug]/wallet', () => {
  it('returns a signed pass with Wallet download headers', async () => {
    const response = await GET(new Request('https://tryshapeup.cc/api/barber/marcus/wallet'), {
      params: Promise.resolve({ slug: 'marcus' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/vnd.apple.pkpass');
    expect(response.headers.get('content-disposition')).toContain('shapeup-marcus.pkpass');
    expect(mocks.createPass).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'marcus' }),
      'https://tryshapeup.cc/b/marcus',
    );
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('signed-pass');
  });

  it('fails closed when signing credentials are missing', async () => {
    mocks.configured = false;
    const response = await GET(new Request('https://tryshapeup.cc/api/barber/marcus/wallet'), {
      params: Promise.resolve({ slug: 'marcus' }),
    });

    expect(response.status).toBe(503);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('does not create passes for unpublished or unknown cards', async () => {
    mocks.query.mockResolvedValue(null);
    const response = await GET(new Request('https://tryshapeup.cc/api/barber/missing/wallet'), {
      params: Promise.resolve({ slug: 'missing' }),
    });

    expect(response.status).toBe(404);
    expect(mocks.createPass).not.toHaveBeenCalled();
  });
});
