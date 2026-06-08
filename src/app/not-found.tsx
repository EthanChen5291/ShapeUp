import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--biscuit)] px-6 text-[var(--ink)]">
      <section className="max-w-md rounded-md border border-[rgba(42,32,26,0.14)] bg-[var(--cream)] p-6 text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--smoke)]">404</p>
        <h1 className="mt-3 font-display text-4xl italic">Page not found</h1>
        <p className="mt-3 font-sans text-sm leading-6 text-[var(--smoke)]">
          This page is not part of the current ShapeUp app.
        </p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-md bg-[var(--tomato)] px-5 py-3 font-sans text-sm font-bold uppercase tracking-wider text-[var(--cream)]"
        >
          Back home
        </Link>
      </section>
    </main>
  );
}
