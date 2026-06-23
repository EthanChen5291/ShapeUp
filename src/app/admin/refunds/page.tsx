'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';

const PlyViewerModal = dynamic(() => import('@/components/PlyViewerModal'), { ssr: false });

interface RefundRow {
  id: string;
  status: 'pending' | 'approved' | 'denied';
  reason?: string;
  username?: string;
  email?: string;
  projectId?: string;
  createdAt: number;
  resolvedAt?: number;
  refundedTokens?: number;
  selfieUrl: string | null;
  splatUrl: string | null;
}

type Filter = 'pending' | 'all';

export default function AdminRefundsPage() {
  const [rows, setRows] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('pending');
  const [viewingSplat, setViewingSplat] = useState<string | null>(null);
  const [tokenAmounts, setTokenAmounts] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/admin-refunds')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setRows(data.requests);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (id: string, action: 'approve' | 'deny') => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch('/api/admin-refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: id,
          action,
          ...(action === 'approve' ? { tokens: tokenAmounts[id] ?? 1 } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed (HTTP ${res.status})`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusyId(null);
    }
  };

  const shown = filter === 'pending' ? rows.filter((r) => r.status === 'pending') : rows;
  const pendingCount = rows.filter((r) => r.status === 'pending').length;

  const statusBadge = (s: RefundRow['status']) => {
    const styles: Record<RefundRow['status'], string> = {
      pending: 'text-amber-400 border-amber-700 bg-amber-950',
      approved: 'text-emerald-400 border-emerald-700 bg-emerald-950',
      denied: 'text-neutral-400 border-neutral-700 bg-neutral-900',
    };
    return <span className={`text-xs px-2 py-0.5 rounded-full border ${styles[s]}`}>{s}</span>;
  };

  return (
    <>
      {viewingSplat && <PlyViewerModal src={viewingSplat} onClose={() => setViewingSplat(null)} />}
      <div className="min-h-screen bg-neutral-950 text-neutral-100 font-mono p-6">
        <div className="flex items-center gap-4 mb-1">
          <h1 className="text-2xl font-bold tracking-tight">Refund Requests</h1>
          <Link href="/admin" className="text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2">
            ← S3 Admin
          </Link>
          <Link href="/admin/feedback" className="text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2">
            Feedback →
          </Link>
        </div>
        <p className="text-neutral-500 text-sm mb-6">
          {loading ? 'Loading…' : `${shown.length} shown · ${pendingCount} pending`}
        </p>

        {/* Filters */}
        <div className="flex gap-2 mb-6">
          {(['pending', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded text-sm border transition-colors ${
                filter === f
                  ? 'bg-amber-500 text-black border-amber-500 font-semibold'
                  : 'bg-neutral-800 text-neutral-300 border-neutral-700 hover:border-amber-500'
              }`}
            >
              {f === 'pending' ? 'Pending' : 'All'}
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
        {!loading && !error && shown.length === 0 && <p className="text-neutral-500">No requests.</p>}

        <div className="flex flex-col gap-3">
          {shown.map((r) => (
            <div key={r.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 flex gap-4">
              {/* Selfie */}
              <div className="shrink-0">
                {r.selfieUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.selfieUrl}
                    alt="selfie"
                    className="w-28 h-28 object-cover rounded-lg border border-neutral-700"
                  />
                ) : (
                  <div className="w-28 h-28 rounded-lg border border-neutral-800 bg-neutral-950 flex items-center justify-center text-xs text-neutral-600 text-center px-2">
                    no selfie
                  </div>
                )}
              </div>

              {/* Body */}
              <div className="flex-1 min-w-0 flex flex-col gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  {statusBadge(r.status)}
                  <span className="text-sm text-neutral-300">{r.username || r.email || 'anonymous'}</span>
                  {r.projectId && <span className="text-xs text-neutral-600 truncate max-w-48">proj {r.projectId}</span>}
                  <span className="ml-auto text-xs text-neutral-600">{new Date(r.createdAt).toLocaleString()}</span>
                </div>

                {r.reason ? (
                  <p className="text-sm text-neutral-200 whitespace-pre-wrap">{r.reason}</p>
                ) : (
                  <p className="text-sm text-neutral-600 italic">no reason given</p>
                )}

                {r.status !== 'pending' && (
                  <p className="text-xs text-neutral-500">
                    {r.status === 'approved'
                      ? `Refunded ${r.refundedTokens ?? 1} token(s)`
                      : 'Denied'}
                    {r.resolvedAt ? ` · ${new Date(r.resolvedAt).toLocaleString()}` : ''}
                  </p>
                )}

                <div className="flex items-center gap-3 flex-wrap mt-1">
                  {r.splatUrl ? (
                    <button
                      onClick={() => setViewingSplat(r.splatUrl!)}
                      className="text-xs text-sky-400 hover:text-sky-300 underline underline-offset-2"
                    >
                      view 3D splat
                    </button>
                  ) : (
                    <span className="text-xs text-neutral-600">no splat</span>
                  )}
                  {r.selfieUrl && (
                    <a
                      href={r.selfieUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2"
                    >
                      open selfie
                    </a>
                  )}

                  {r.status === 'pending' && (
                    <div className="ml-auto flex items-center gap-2">
                      <label className="text-xs text-neutral-500">tokens</label>
                      <input
                        type="number"
                        min={1}
                        value={tokenAmounts[r.id] ?? 1}
                        onChange={(e) =>
                          setTokenAmounts((m) => ({ ...m, [r.id]: Math.max(1, parseInt(e.target.value) || 1) }))
                        }
                        className="w-14 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm text-neutral-200 focus:outline-none focus:border-amber-500"
                      />
                      <button
                        disabled={busyId === r.id}
                        onClick={() => resolve(r.id, 'approve')}
                        className="px-3 py-1 rounded text-sm bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors disabled:opacity-50"
                      >
                        {busyId === r.id ? '…' : 'Approve'}
                      </button>
                      <button
                        disabled={busyId === r.id}
                        onClick={() => resolve(r.id, 'deny')}
                        className="px-3 py-1 rounded text-sm bg-neutral-800 border border-neutral-700 text-neutral-300 hover:border-red-500 hover:text-red-400 transition-colors disabled:opacity-50"
                      >
                        Deny
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
