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
  const [y, m, d] = updated.split('-');
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const formattedDate = `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;

  return (
    <main className="min-h-screen bg-[var(--biscuit)] text-[var(--ink)]">
      {/* Nav */}
      <nav className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-6" aria-label="Legal">
        <Link href="/" className="font-display italic text-2xl text-[var(--ink)] hover:opacity-70 transition-opacity">
          ShapeUp
        </Link>
        <Link href="/privacy" className="font-mono text-xs uppercase tracking-widest text-[var(--smoke)] hover:text-[var(--char)] transition-colors">
          Trust center
        </Link>
      </nav>

      <article className="mx-auto w-full max-w-3xl px-5 pb-20">
        {/* Title block */}
        <header className="mb-5 rounded-xl border border-[rgba(42,32,26,0.12)] bg-[var(--cream)] px-7 py-6">
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--smoke)] mb-3">Legal</p>
          <h1 className="font-display text-4xl italic leading-tight md:text-5xl">{title}</h1>
          <p className="mt-3 font-sans text-xs text-[var(--smoke)] flex items-center gap-1.5">
            <span className="inline-block w-1 h-1 rounded-full bg-[var(--smoke)] opacity-60" />
            Last updated {formattedDate}
          </p>
        </header>

        {/* Body */}
        <div className="legal-prose rounded-xl border border-[rgba(42,32,26,0.10)] bg-[var(--cream)] px-7 py-8 font-sans text-[0.9375rem] text-[var(--char)] md:px-10 md:py-10">
          {children}
        </div>

        {/* Footer nav */}
        <footer className="mt-6 flex items-center justify-between font-mono text-xs uppercase tracking-widest text-[var(--smoke)]">
          <Link href="/" className="hover:text-[var(--char)] transition-colors">← Back to ShapeUp</Link>
          <Link href="/privacy" className="hover:text-[var(--char)] transition-colors">Trust center</Link>
        </footer>
      </article>
    </main>
  );
}
