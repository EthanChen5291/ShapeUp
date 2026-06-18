'use client';

import { useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import SignUpWidget from '@/components/SignUpWidget';

export default function SignUpPage() {
  const { isSignedIn } = useUser();
  const router = useRouter();

  // Already signed in? Skip the form entirely.
  useEffect(() => {
    if (isSignedIn) router.replace('/dashboard');
  }, [isSignedIn, router]);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--ink, #14100c)',
      }}
    >
      <SignUpWidget onEnter={() => router.push('/dashboard')} redirectUrlComplete="/dashboard" />
    </main>
  );
}
