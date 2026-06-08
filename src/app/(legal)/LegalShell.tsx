import Link from 'next/link';
import type { ReactNode } from 'react';

export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[var(--biscuit)] text-[var(--ink)]">
      <nav className="mx-auto flex w-full max-w-4xl items-center justify-between px-5 py-6" aria-label="Legal">
        <Link href="/" className="font-display italic text-2xl text-[var(--ink)]">
          ShapeUp
        </Link>
        <Link href="/privacy" className="font-mono text-xs uppercase tracking-widest text-[var(--smoke)]">
          Trust center
        </Link>
      </nav>
      <article className="legal-page mx-auto w-full max-w-4xl px-5 pb-16">
        <div className="mb-6 rounded-md border border-[rgba(42,32,26,0.14)] bg-[var(--cream)] p-5">
          <h1 className="font-display text-4xl italic leading-tight md:text-6xl">{title}</h1>
          <p className="mt-3 font-sans text-sm text-[var(--smoke)]">Last updated: {updated}</p>
        </div>
        <div className="rounded-md border border-[rgba(42,32,26,0.12)] bg-[var(--cream)] p-6 font-sans text-base leading-7 text-[var(--char)] md:p-8">
          {children}
        </div>
      </article>
    </main>
  );
}
