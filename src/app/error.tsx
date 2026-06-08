'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error('[global-error]', error.digest ?? error.message);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--biscuit)] px-6 text-[var(--ink)]">
      <section className="max-w-md rounded-md border border-[rgba(42,32,26,0.14)] bg-[var(--cream)] p-6 text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--tomato)]">Something slipped</p>
        <h1 className="mt-3 font-display text-4xl italic">Try that again?</h1>
        <p className="mt-3 font-sans text-sm leading-6 text-[var(--smoke)]">
          ShapeUp hit an unexpected error. No stack trace is shown here.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 rounded-md bg-[var(--tomato)] px-5 py-3 font-sans text-sm font-bold uppercase tracking-wider text-[var(--cream)]"
        >
          Reload this view
        </button>
      </section>
    </main>
  );
}
