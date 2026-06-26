import { track } from './analytics';

export interface CheckoutOptions {
  /**
   * Plan id (starter/popular/pro). Omit for the server default ("popular"),
   * used by out-of-credits fallbacks that just need to send the user to buy.
   */
  plan?: string;
  /** Relative path to return to after payment (validated server-side). */
  returnUrl?: string;
  /** Where checkout was initiated, for funnel attribution. */
  source: string;
}

/**
 * Start a Stripe checkout from one place: fire the `checkout_started` analytics
 * event, create the session, and redirect the browser to Stripe. Returns the
 * checkout URL on success, or null if the server returned none.
 *
 * Centralizes what used to be five divergent `/api/stripe/checkout` fetches so
 * the funnel is measured consistently and the request shape can't drift.
 */
export async function startCheckout({ plan, returnUrl, source }: CheckoutOptions): Promise<string | null> {
  // Mirror the server default ("popular") so the event reflects what's bought.
  track('checkout_started', { plan: plan ?? 'popular', source });

  // The out-of-credits fallbacks historically sent no body (server defaults the
  // plan); preserve that so behavior is identical to the call sites we replaced.
  const hasBody = plan != null || returnUrl != null;
  const res = await fetch('/api/stripe/checkout', {
    method: 'POST',
    ...(hasBody
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan, returnUrl }) }
      : {}),
  });

  const { url } = (await res.json().catch(() => ({}))) as { url?: string };
  if (url) {
    window.location.href = url;
    return url;
  }
  return null;
}
