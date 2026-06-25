'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { useRouter } from 'next/navigation';
import { WaitlistPage } from '@/components/WaitlistPage';
import LoadingScreen from '@/components/LoadingScreen';
import LandingPage from '@/components/LandingPage';
import { captureReferralFromUrl, clearPendingReferralCode, getPendingReferralCode } from '@/lib/referral';

type AppState = 'loading' | 'landing';

export default function Home() {
  const { isSignedIn, isLoaded } = useUser();
  const router = useRouter();
  const getOrCreate = useMutation(api.users.getOrCreate);
  useQuery(api.users.getMe);

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); captureReferralFromUrl(); }, []);

  useEffect(() => {
    if (isSignedIn) {
      getOrCreate({ referralCode: getPendingReferralCode() })
        .then(() => clearPendingReferralCode())
        .catch((err) => console.error('[Home] getOrCreate FAILED:', err));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  // Preload critical landing page images so loading screen stays up until they're ready
  const [landingAssetsReady, setLandingAssetsReady] = useState(false);
  useEffect(() => {
    const LANDING_IMAGES = [
      '/offwhitebg.png',
      '/blob.png',
      '/tape.png',
      '/landing_face2/face2_selfie.png',
      '/1.png',
      '/2.png',
      '/3.png',
    ];
    let loaded = 0;
    const onLoad = () => { if (++loaded === LANDING_IMAGES.length) setLandingAssetsReady(true); };
    LANDING_IMAGES.forEach(src => {
      const img = new window.Image();
      img.onload = onLoad;
      img.onerror = onLoad;
      img.src = src;
    });
  }, []);

  // Only landing/loading live here; dashboard and studio are their own routes
  const [appState, setAppState] = useState<AppState>('landing');

  // Redirect signed-in users to /dashboard
  useEffect(() => {
    if (isSignedIn) router.push('/dashboard');
  }, [isSignedIn, router]);

  // ── Waitlist gate ──
  const isWaitlistMode = process.env.NEXT_PUBLIC_WAITLIST_MODE === '1';
  const isTargetDomain = mounted && (
    window.location.hostname === 'nomorebadhaircuts.com' ||
    window.location.hostname === 'www.nomorebadhaircuts.com' ||
    process.env.NODE_ENV === 'development'
  ) && window.location.hostname !== 'dev.nomorebadhaircuts.com';
  if (isWaitlistMode && !mounted) return null;
  if (isWaitlistMode && isTargetDomain) return <WaitlistPage />;

  // Don't flash the landing page while Clerk is still resolving the session, or
  // for signed-in users who are about to be pushed to /dashboard. Either case
  // would otherwise paint <LandingPage> for a beat before the redirect fires.
  if (!isLoaded || isSignedIn) {
    return <LoadingScreen onDone={() => {}} ready={false} />;
  }

  if (appState === 'loading') {
    return <LoadingScreen onDone={() => setAppState('landing')} ready={landingAssetsReady} />;
  }

  return <LandingPage onEnter={() => router.push('/dashboard')} />;
}
