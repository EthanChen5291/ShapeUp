// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }));
vi.mock('./analytics', () => ({ track: trackMock }));

import { startCheckout } from './checkout';

describe('startCheckout', () => {
  beforeEach(() => {
    trackMock.mockReset();
    // Make location assignable without triggering jsdom's "navigation not
    // implemented" error when the helper sets href.
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true });
  });

  it('fires checkout_started with plan + source and redirects to the Stripe url', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ json: async () => ({ url: 'https://stripe.test/session' }) });
    vi.stubGlobal('fetch', fetchMock);

    const url = await startCheckout({ plan: 'pro', returnUrl: '/studio/x', source: 'pricing_popup' });

    expect(trackMock).toHaveBeenCalledWith('checkout_started', { plan: 'pro', source: 'pricing_popup' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/stripe/checkout',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ plan: 'pro', returnUrl: '/studio/x' }) }),
    );
    expect(url).toBe('https://stripe.test/session');
    expect(window.location.href).toBe('https://stripe.test/session');
  });

  it('sends no body for the default-plan fallback and labels the event "popular"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ url: 'https://stripe.test/s2' }) });
    vi.stubGlobal('fetch', fetchMock);

    await startCheckout({ source: 'facelift_out_of_credits' });

    expect(trackMock).toHaveBeenCalledWith('checkout_started', {
      plan: 'popular',
      source: 'facelift_out_of_credits',
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeUndefined();
  });

  it('returns null and does not redirect when the server returns no url', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({}) }));

    const url = await startCheckout({ plan: 'starter', source: 'pricing_page' });

    expect(url).toBeNull();
    expect(window.location.href).toBe('');
  });
});
