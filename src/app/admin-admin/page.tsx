'use client';

import { useEffect, useState, useMemo } from 'react';

interface FaceliftRow {
  id: string;
  jobId: string;
  userId: string;
  createdAt: number;
  plyKey: string;
  splatKey: string;
  plyUrl: string;
  splatUrl: string;
}

export default function AdminPage() {
  const [facelifts, setFacelifts] = useState<FaceliftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    fetch('/api/admin-facelifts')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setFacelifts(data.facelifts);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const fromMs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toMs = dateTo ? new Date(dateTo + 'T23:59:59').getTime() : null;
    return facelifts.filter((f) => {
      if (fromMs !== null && f.createdAt < fromMs) return false;
      if (toMs !== null && f.createdAt > toMs) return false;
      return true;
    });
  }, [facelifts, dateFrom, dateTo]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-mono p-6">
      <h1 className="text-2xl font-bold mb-1 tracking-tight">Facelift Renders</h1>
      <p className="text-neutral-500 text-sm mb-6">
        {facelifts.length} total &nbsp;·&nbsp; {filtered.length} shown
      </p>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-8 p-4 bg-neutral-900 rounded-xl border border-neutral-800">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-neutral-400 uppercase tracking-widest">from</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm text-neutral-200 focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-neutral-400 uppercase tracking-widest">to</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm text-neutral-200 focus:outline-none focus:border-amber-500"
          />
        </div>

        {(dateFrom || dateTo) && (
          <div className="flex flex-col justify-end">
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              className="px-3 py-1 rounded text-sm bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors"
            >
              clear
            </button>
          </div>
        )}
      </div>

      {loading && <p className="text-neutral-500">Loading renders…</p>}
      {error && <p className="text-red-400">Error: {error}</p>}

      {!loading && !error && (
        <div className="flex flex-col gap-3">
          {filtered.length === 0 && (
            <p className="text-neutral-500">No renders match the current filters.</p>
          )}
          {filtered.map((f) => (
            <div
              key={f.id}
              className="bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 flex items-center gap-4"
            >
              <span className="text-amber-400 text-xs w-48 shrink-0 truncate" title={f.jobId}>
                {f.jobId}
              </span>

              <span className="text-neutral-400 text-xs w-44 shrink-0">
                {new Date(f.createdAt).toLocaleString()}
              </span>

              <span className="text-neutral-500 text-xs w-40 shrink-0 truncate" title={f.userId}>
                {f.userId}
              </span>

              <div className="ml-auto flex gap-2 shrink-0">
                <a
                  href={f.splatUrl}
                  download={`${f.jobId}.splat`}
                  className="px-3 py-1 rounded text-xs bg-amber-500 text-black border border-amber-500 hover:bg-amber-400 transition-colors"
                >
                  ↓ .splat
                </a>
                <a
                  href={f.plyUrl}
                  download={`${f.jobId}.ply`}
                  className="px-3 py-1 rounded text-xs bg-neutral-800 text-amber-400 border border-neutral-700 hover:border-amber-500 transition-colors"
                >
                  ↓ .ply
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
