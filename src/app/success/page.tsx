'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function SuccessContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [dots, setDots] = useState('');

  useEffect(() => {
    const sessionId = params.get('session_id');
    if (sessionId) {
      localStorage.setItem('shapeup_paid', 'true');
    }
    const t = setTimeout(() => router.push('/'), 2800);
    return () => clearTimeout(t);
  }, [params, router]);

  useEffect(() => {
    const id = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 500);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="min-h-screen bg-tomato-shop flex flex-col items-center justify-center gap-8">
      <div className="text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-[var(--cream)]/60 mb-4">
          payment confirmed
        </p>
        <h1
          className="type-chonk text-[var(--cream)]"
          style={{ fontSize: 'clamp(3rem, 10vw, 8rem)' }}
        >
          SH<em>a</em>PE
          <br />
          <em>U</em>P ✂
        </h1>
        <p className="mt-6 font-serif italic text-[var(--cream)]/80 text-xl">
          50 generations unlocked. Heading back{dots}
        </p>
      </div>

      <div
        className="rounded-2xl px-8 py-5 text-center"
        style={{
          background: 'var(--biscuit-lt)',
          border: '1px solid rgba(42,32,26,0.12)',
          boxShadow: '0 20px 40px -16px rgba(0,0,0,0.35)',
        }}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--char)]/60 mb-1">
          your order
        </p>
        <p className="font-serif text-[var(--char)] text-lg">
          ShapeUp — 50 Haircut Generations
        </p>
        <p className="font-sans text-[var(--char)]/60 text-sm mt-1">$4.99</p>
      </div>
    </main>
  );
}

export default function SuccessPage() {
  return (
    <Suspense>
      <SuccessContent />
    </Suspense>
  );
}
