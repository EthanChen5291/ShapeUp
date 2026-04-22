'use client';

import { useEffect, useState, useMemo } from 'react';

interface SessionRow {
  id: string;
  createdAt: string | null;
  images: string[];
  hair_plys: string[];
  hasHairPly: boolean;
  currentProfile: unknown;
}

type HairPlyFilter = 'all' | 'with' | 'without';

export default function AdminPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [hairPlyFilter, setHairPlyFilter] = useState<HairPlyFilter>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin-sessions')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setSessions(data.sessions);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (hairPlyFilter === 'with' && !s.hasHairPly) return false;
      if (hairPlyFilter === 'without' && s.hasHairPly) return false;
      if (dateFrom && s.createdAt && s.createdAt < dateFrom) return false;
      if (dateTo && s.createdAt && s.createdAt > dateTo + 'T23:59:59') return false;
      return true;
    });
  }, [sessions, hairPlyFilter, dateFrom, dateTo]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-mono p-6">
      <h1 className="text-2xl font-bold mb-1 tracking-tight">Session Admin</h1>
      <p className="text-neutral-500 text-sm mb-6">
        {sessions.length} total &nbsp;·&nbsp; {filtered.length} shown
      </p>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-8 p-4 bg-neutral-900 rounded-xl border border-neutral-800">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-neutral-400 uppercase tracking-widest">hair_ply</label>
          <div className="flex gap-1">
            {(['all', 'with', 'without'] as HairPlyFilter[]).map((v) => (
              <button
                key={v}
                onClick={() => setHairPlyFilter(v)}
                className={`px-3 py-1 rounded text-sm border transition-colors ${
                  hairPlyFilter === v
                    ? 'bg-amber-500 text-black border-amber-500'
                    : 'bg-neutral-800 text-neutral-300 border-neutral-700 hover:border-amber-500'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

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

        {(dateFrom || dateTo || hairPlyFilter !== 'all') && (
          <div className="flex flex-col justify-end">
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); setHairPlyFilter('all'); }}
              className="px-3 py-1 rounded text-sm bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors"
            >
              clear
            </button>
          </div>
        )}
      </div>

      {loading && <p className="text-neutral-500">Loading sessions…</p>}
      {error && <p className="text-red-400">Error: {error}</p>}

      {!loading && !error && (
        <div className="flex flex-col gap-3">
          {filtered.length === 0 && (
            <p className="text-neutral-500">No sessions match the current filters.</p>
          )}
          {filtered.map((s) => (
            <div
              key={s.id}
              className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden"
            >
              {/* Row header */}
              <div
                className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-neutral-800 transition-colors"
                onClick={() => setExpanded(expanded === s.id ? null : s.id)}
              >
                <span className="text-amber-400 text-xs w-48 shrink-0 truncate">{s.id}</span>

                <span className="text-neutral-400 text-xs w-44 shrink-0">
                  {s.createdAt
                    ? new Date(s.createdAt).toLocaleString()
                    : '—'}
                </span>

                <span
                  className={`text-xs px-2 py-0.5 rounded-full border ${
                    s.hasHairPly
                      ? 'text-emerald-400 border-emerald-700 bg-emerald-950'
                      : 'text-neutral-500 border-neutral-700 bg-neutral-900'
                  }`}
                >
                  {s.hasHairPly ? `${s.hair_plys.length} ply` : 'no ply'}
                </span>

                <span className="text-neutral-500 text-xs">
                  {s.images.length} img{s.images.length !== 1 ? 's' : ''}
                </span>

                <span className="ml-auto text-neutral-600 text-xs">
                  {expanded === s.id ? '▲' : '▼'}
                </span>
              </div>

              {/* Expanded detail */}
              {expanded === s.id && (
                <div className="border-t border-neutral-800 p-4 flex flex-col gap-4">
                  {/* Images */}
                  {s.images.length > 0 && (
                    <div>
                      <p className="text-xs text-neutral-500 uppercase tracking-widest mb-2">Images</p>
                      <div className="flex flex-wrap gap-2">
                        {s.images.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={`scan ${i}`}
                              className="w-24 h-24 object-cover rounded-lg border border-neutral-700 hover:border-amber-500 transition-colors"
                            />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* PLY links */}
                  {s.hair_plys.length > 0 && (
                    <div>
                      <p className="text-xs text-neutral-500 uppercase tracking-widest mb-2">hair_plys</p>
                      <div className="flex flex-col gap-1">
                        {s.hair_plys.map((url, i) => (
                          <a
                            key={i}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-amber-400 hover:text-amber-300 truncate underline underline-offset-2"
                          >
                            ply_{i}: {url}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* currentProfile JSON */}
                  {!!s.currentProfile && (
                    <div>
                      <p className="text-xs text-neutral-500 uppercase tracking-widest mb-2">currentProfile</p>
                      <pre className="text-xs bg-neutral-950 rounded-lg p-3 overflow-auto max-h-64 text-neutral-300 border border-neutral-800">
                        {JSON.stringify(s.currentProfile, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
