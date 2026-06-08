'use client';

import { useUser } from '@clerk/nextjs';
import { useState } from 'react';

export function DeleteAccountPanel() {
  const { isSignedIn } = useUser();
  const [confirmation, setConfirmation] = useState('');
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const canDelete = isSignedIn && confirmation === 'DELETE';

  const handleDelete = async () => {
    if (!canDelete) return;
    setStatus('working');
    setMessage('');
    const res = await fetch('/api/account/delete', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus('error');
      setMessage(data.error ?? 'Deletion failed. Please contact support.');
      return;
    }
    setStatus('done');
    setMessage('Your account deletion request was processed. You may need to refresh or sign in again if this browser still has an old session.');
  };

  return (
    <section className="mt-6 rounded-md border border-[rgba(214,60,47,0.25)] bg-[rgba(214,60,47,0.06)] p-5">
      <h2 className="font-display text-2xl italic text-[var(--ink)]">Delete account and data</h2>
      <p className="mt-2 font-sans text-sm leading-6 text-[var(--char)]">
        This attempts to delete your Convex account records, owned project/session metadata, S3 scan images and derived
        PLY/SPLAT assets, then your Clerk account. Type DELETE to confirm.
      </p>
      {!isSignedIn && (
        <p className="mt-4 rounded-md bg-[var(--cream)] p-3 font-sans text-sm text-[var(--tomato)]">
          Sign in first so ShapeUp can identify which account to delete.
        </p>
      )}
      <input
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        placeholder="DELETE"
        aria-label="Type DELETE to confirm account deletion"
        className="mt-4 w-full rounded-md border border-[rgba(42,32,26,0.2)] bg-[var(--cream)] px-4 py-3 font-mono text-sm outline-none"
      />
      <button
        type="button"
        disabled={!canDelete || status === 'working'}
        onClick={handleDelete}
        className="mt-4 rounded-md bg-[var(--tomato)] px-5 py-3 font-sans text-sm font-bold uppercase tracking-wider text-[var(--cream)] disabled:cursor-not-allowed disabled:opacity-45"
      >
        {status === 'working' ? 'Deleting...' : 'Delete my account and data'}
      </button>
      {message && (
        <p aria-live="polite" className="mt-4 font-sans text-sm text-[var(--char)]">
          {message}
        </p>
      )}
    </section>
  );
}
