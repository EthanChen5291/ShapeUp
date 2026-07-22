'use client';

import { useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { useRouter } from 'next/navigation';
import BarberLandingPage from '@/components/BarberLandingPage';
import { captureReferralFromUrl, clearPendingReferralCode, getPendingReferralCode } from '@/lib/referral';

export default function Home() {
  const { isSignedIn, isLoaded } = useUser();
  const router = useRouter();
  const getOrCreate = useMutation(api.users.getOrCreate);
  useQuery(api.users.getMe);

  useEffect(() => { captureReferralFromUrl(); }, []);

  useEffect(() => {
    if (isSignedIn) {
      getOrCreate({ referralCode: getPendingReferralCode() })
        .then(() => clearPendingReferralCode())
        .catch((err) => console.error('[Home] getOrCreate FAILED:', err));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  // ShapeUp is now a barber-card product: signed-in users land in the card
  // studio, while the public home page explains and sells that one workflow.
  useEffect(() => {
    if (isSignedIn) router.push('/barber');
  }, [isSignedIn, router]);

  // Don't flash the landing page while Clerk is still resolving the session, or
  // for signed-in users who are about to be pushed to the card studio. Either
  // case would otherwise paint the marketing page for a beat first.
  if (!isLoaded || isSignedIn) {
    return null;
  }

  return <BarberLandingPage />;
}
