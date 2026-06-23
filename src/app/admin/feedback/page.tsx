'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface FeedbackRow {
  _id: string;
  rating: number;
  comment?: string;
  route?: string;
  projectId?: string;
  email?: string;
  username?: string;
  createdAt: number;
}

type Filter = 'all' | 'low'; // 'low' = ≤2★

function stars(n: number) {
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

export default function AdminFeedbackPage() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/admin-feedback')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setRows(data.feedback);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = filter === 'low' ? rows.filter((r) => r.rating <= 2) : rows;
  const count = rows.length;
  const avg = count > 0 ? (rows.reduce((a, r) => a + r.rating, 0) / count).toFixed(2) : '—';
  const dist = [5, 4, 3, 2, 1].map((n) => ({ n, c: rows.filter((r) => r.rating === n).length }));

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-mono p-6">
      <div className="flex items-center gap-4 mb-1">
        <h1 className="text-2xl font-bold tracking-tight">Feedback</h1>
        <Link href="/admin" className="text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2">
          ← S3 Admin
        </Link>
        <Link href="/admin/refunds" className="text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2">
          Refunds →
        </Link>
      </div>
      <p className="text-neutral-500 text-sm mb-6">
        {loading ? 'Loading…' : `${shown.length} of ${count} shown · avg ${avg}/5`}
      </p>

      {/* Summary */}
      <div className="flex flex-wrap gap-6 mb-6 p-4 bg-neutral-900 rounded-xl border border-neutral-800">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-neutral-400 uppercase tracking-widest">average</span>
          <span className="text-3xl font-bold text-amber-400">{avg}</span>
        </div>
        <div className="flex flex-col gap-1 justify-center">
          {dist.map(({ n, c }) => (
            <div key={n} className="flex items-center gap-2 text-xs">
              <span className="text-neutral-500 w-3">{n}</span>
              <span className="text-amber-400">★</span>
              <div className="w-40 h-2 bg-neutral-800 rounded-full overflow-hidden">
                <div
                  className={n <= 2 ? 'h-full bg-red-500' : 'h-full bg-emerald-500'}
                  style={{ width: count > 0 ? `${(c / count) * 100}%` : '0%' }}
                />
              </div>
              <span className="text-neutral-500 w-6">{c}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6">
        {(['all', 'low'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded text-sm border transition-colors ${
              filter === f
                ? 'bg-amber-500 text-black border-amber-500 font-semibold'
                : 'bg-neutral-800 text-neutral-300 border-neutral-700 hover:border-amber-500'
            }`}
          >
            {f === 'all' ? 'All' : 'Low (≤2★)'}
          </button>
        ))}
        <button
          onClick={load}
          className="ml-auto px-3 py-1.5 rounded text-sm bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors"
        >
          refresh
        </button>
      </div>

      {error && <p className="text-red-400 mb-4">Error: {error}</p>}
      {!loading && !error && shown.length === 0 && <p className="text-neutral-500">No feedback yet.</p>}

      <div className="flex flex-col gap-2">
        {shown.map((r) => {
          const low = r.rating <= 2;
          return (
            <div
              key={r._id}
              className={`rounded-xl border p-4 ${
                low ? 'bg-red-950/30 border-red-800/60' : 'bg-neutral-900 border-neutral-800'
              }`}
            >
              <div className="flex items-center gap-4 flex-wrap">
                <span className={`text-sm tracking-widest ${low ? 'text-red-400' : 'text-amber-400'}`}>
                  {stars(r.rating)}
                </span>
                <span className="text-xs text-neutral-400">{r.username || r.email || 'anonymous'}</span>
                {r.route && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400 border border-neutral-700">
                    {r.route}
                  </span>
                )}
                {r.projectId && <span className="text-xs text-neutral-600 truncate max-w-40">proj {r.projectId}</span>}
                <span className="ml-auto text-xs text-neutral-600">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>
              {r.comment && (
                <p className="mt-2 text-sm text-neutral-200 whitespace-pre-wrap">{r.comment}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
