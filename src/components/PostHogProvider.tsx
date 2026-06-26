'use client';

import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth, useUser } from '@clerk/nextjs';
import posthog from 'posthog-js';
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react';

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
// Reverse-proxied through Next.js rewrites (see next.config.ts) so events are
// posted to our own origin and survive ad-blockers. ui_host points at the real
// PostHog app so "view in PostHog" links resolve correctly.
const apiHost = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? '/ingest';
const uiHost = 'https://us.posthog.com';

if (typeof window !== 'undefined' && posthogKey && !posthog.__loaded) {
  posthog.init(posthogKey, {
    api_host: apiHost,
    ui_host: uiHost,
    // We capture pageviews manually below to handle App Router client-side
    // navigations (which don't trigger a full page load).
    capture_pageview: false,
    capture_pageleave: true,
    person_profiles: 'identified_only',
  });
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  // Mirror ConvexClerkProvider: if PostHog isn't configured, no-op cleanly.
  if (!posthogKey) return <>{children}</>;
  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      <PostHogIdentify />
      {children}
    </PHProvider>
  );
}

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ph = usePostHog();

  useEffect(() => {
    if (!pathname || !ph) return;
    let url = window.origin + pathname;
    const search = searchParams.toString();
    if (search) url += `?${search}`;
    ph.capture('$pageview', { $current_url: url });
  }, [pathname, searchParams, ph]);

  return null;
}

function PostHogIdentify() {
  const ph = usePostHog();
  const { isSignedIn, isLoaded } = useAuth();
  const { user } = useUser();

  useEffect(() => {
    if (!ph || !isLoaded) return;
    if (isSignedIn && user) {
      ph.identify(user.id, {
        email: user.primaryEmailAddress?.emailAddress,
        name: user.fullName ?? undefined,
      });
      // Fire a one-time signup event for genuinely new accounts. We can't ask
      // Clerk "did this user just sign up", so we treat an account created in
      // the last 10 minutes as a signup and guard with localStorage so it fires
      // at most once per user per browser (survives re-mounts and re-logins).
      try {
        const createdAt = user.createdAt?.getTime();
        const isRecent = createdAt != null && Date.now() - createdAt < 10 * 60 * 1000;
        const guardKey = `ph_signup_${user.id}`;
        if (isRecent && !localStorage.getItem(guardKey)) {
          localStorage.setItem(guardKey, '1');
          ph.capture('user_signed_up');
        }
      } catch {
        // localStorage unavailable / analytics must never break auth.
      }
    } else if (!isSignedIn) {
      // Logged out: detach the previous identity from this browser session.
      ph.reset();
    }
  }, [ph, isLoaded, isSignedIn, user]);

  return null;
}
