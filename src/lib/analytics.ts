import posthog from 'posthog-js';

/**
 * Typed product-analytics events. Keep this list small and meaningful — these
 * are the funnel/conversion moments worth measuring, not every click.
 */
export type AnalyticsEvent =
  | 'user_signed_up'
  | 'project_created'
  | 'image_generated'
  | 'checkout_started'
  | 'purchase_completed'
  | 'refund_requested';

/**
 * Fire a product-analytics event. Safe to call anywhere:
 * - no-ops on the server,
 * - no-ops when PostHog isn't configured (no NEXT_PUBLIC_POSTHOG_KEY), and
 * - never throws into product flows.
 */
export function track(event: AnalyticsEvent, props?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  try {
    // posthog.__loaded is only true after init() runs, which is gated on the
    // key being present (see PostHogProvider). Guards against capturing into an
    // uninitialized client.
    if (!posthog.__loaded) return;
    posthog.capture(event, props);
  } catch {
    // Analytics must never break the product.
  }
}
