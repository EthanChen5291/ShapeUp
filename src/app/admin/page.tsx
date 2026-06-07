'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';

const PlyViewerModal = dynamic(() => import('@/components/PlyViewerModal'), { ssr: false });

interface S3File {
  key: string;
  filename: string;
  size: number;
  lastModified: string;
  url: string;
}

interface S3Group {
  id: string;
  lastModified: string;
  files: S3File[];
}

type Section = 'images' | 'facelifts';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function AdminS3Page() {
  const [section, setSection] = useState<Section>('images');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [results, setResults] = useState<S3Group[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [viewingPly, setViewingPly] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setExpanded(null);
    const params = new URLSearchParams({ section, search, dateFrom, dateTo });
    fetch(`/api/admin-s3?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setResults(data.results);
        setTotal(data.total);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [section, search, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const clearFilters = () => {
    setSearch('');
    setDateFrom('');
    setDateTo('');
  };

  const hasFilters = search || dateFrom || dateTo;

  return (
    <>
      {viewingPly && <PlyViewerModal src={viewingPly} onClose={() => setViewingPly(null)} />}
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-mono p-6">
      <h1 className="text-2xl font-bold mb-1 tracking-tight">S3 Admin</h1>
      <p className="text-neutral-500 text-sm mb-6">
        {loading ? 'Loading…' : `${results.length} of ${total} shown`}
      </p>

      {/* Section tabs */}
      <div className="flex gap-2 mb-6">
        {(['images', 'facelifts'] as Section[]).map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={`px-4 py-1.5 rounded text-sm border transition-colors ${
              section === s
                ? 'bg-amber-500 text-black border-amber-500 font-semibold'
                : 'bg-neutral-800 text-neutral-300 border-neutral-700 hover:border-amber-500'
            }`}
          >
            {s === 'images' ? 'Images (pictures/)' : 'Facelifts (facelifts/)'}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-8 p-4 bg-neutral-900 rounded-xl border border-neutral-800">
        <div className="flex flex-col gap-1 flex-1 min-w-48">
          <label className="text-xs text-neutral-400 uppercase tracking-widest">search id</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={section === 'images' ? 'session_…' : 'job id…'}
            className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm text-neutral-200 focus:outline-none focus:border-amber-500 placeholder:text-neutral-600"
          />
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

        {hasFilters && (
          <div className="flex flex-col justify-end">
            <button
              onClick={clearFilters}
              className="px-3 py-1 rounded text-sm bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors"
            >
              clear
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-red-400 mb-4">Error: {error}</p>}

      {/* Results */}
      {!loading && !error && results.length === 0 && (
        <p className="text-neutral-500">No entries found.</p>
      )}

      {section === 'images' ? (
        <ImagesSection groups={results} expanded={expanded} setExpanded={setExpanded} />
      ) : (
        <FaceliftSection groups={results} expanded={expanded} setExpanded={setExpanded} onViewPly={setViewingPly} />
      )}
    </div>
    </>
  );
}

function ImagesSection({
  groups,
  expanded,
  setExpanded,
}: {
  groups: S3Group[];
  expanded: string | null;
  setExpanded: (id: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => {
        const imageFiles = g.files.filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f.filename));
        const isOpen = expanded === g.id;
        return (
          <div key={g.id} className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
            <div
              className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-neutral-800 transition-colors"
              onClick={() => setExpanded(isOpen ? null : g.id)}
            >
              <span className="text-amber-400 text-xs w-64 shrink-0 truncate">{g.id}</span>
              <span className="text-neutral-400 text-xs w-44 shrink-0">
                {new Date(g.lastModified).toLocaleString()}
              </span>
              <span className="text-neutral-500 text-xs">
                {imageFiles.length} image{imageFiles.length !== 1 ? 's' : ''}
              </span>
              <span className="ml-auto text-neutral-600 text-xs">{isOpen ? '▲' : '▼'}</span>
            </div>

            {isOpen && (
              <div className="border-t border-neutral-800 p-4">
                {imageFiles.length > 0 ? (
                  <div className="flex flex-wrap gap-3">
                    {imageFiles.map((f) => (
                      <div key={f.key} className="flex flex-col gap-1">
                        <a href={f.url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/admin-s3/proxy?key=${encodeURIComponent(f.key)}`}
                            alt={f.filename}
                            className="w-32 h-32 object-cover rounded-lg border border-neutral-700 hover:border-amber-500 transition-colors"
                          />
                        </a>
                        <span className="text-xs text-neutral-500 text-center">{f.filename}</span>
                        <span className="text-xs text-neutral-600 text-center">{formatBytes(f.size)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-neutral-600 text-xs">No image files in this folder.</p>
                )}

                {/* Non-image files */}
                {g.files.filter((f) => !/\.(png|jpg|jpeg|webp)$/i.test(f.filename)).length > 0 && (
                  <div className="mt-3 flex flex-col gap-1">
                    <p className="text-xs text-neutral-500 uppercase tracking-widest mb-1">Other files</p>
                    {g.files
                      .filter((f) => !/\.(png|jpg|jpeg|webp)$/i.test(f.filename))
                      .map((f) => (
                        <a
                          key={f.key}
                          href={f.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2"
                        >
                          {f.filename} ({formatBytes(f.size)})
                        </a>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FaceliftSection({
  groups,
  expanded,
  setExpanded,
  onViewPly,
}: {
  groups: S3Group[];
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  onViewPly: (url: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => {
        const ply = g.files.find((f) => f.filename === 'output.ply');
        const splat = g.files.find((f) => f.filename === 'output.splat');
        const isOpen = expanded === g.id;

        return (
          <div key={g.id} className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
            <div
              className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-neutral-800 transition-colors"
              onClick={() => setExpanded(isOpen ? null : g.id)}
            >
              <span className="text-amber-400 text-xs w-64 shrink-0 truncate">{g.id}</span>
              <span className="text-neutral-400 text-xs w-44 shrink-0">
                {new Date(g.lastModified).toLocaleString()}
              </span>
              <div className="flex gap-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border ${
                    ply
                      ? 'text-emerald-400 border-emerald-700 bg-emerald-950'
                      : 'text-neutral-600 border-neutral-700'
                  }`}
                >
                  PLY
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border ${
                    splat
                      ? 'text-sky-400 border-sky-700 bg-sky-950'
                      : 'text-neutral-600 border-neutral-700'
                  }`}
                >
                  SPLAT
                </span>
              </div>
              <span className="text-neutral-600 text-xs">
                {g.files.reduce((acc, f) => acc + f.size, 0) > 0
                  ? formatBytes(g.files.reduce((acc, f) => acc + f.size, 0))
                  : ''}
              </span>
              <span className="ml-auto text-neutral-600 text-xs">{isOpen ? '▲' : '▼'}</span>
            </div>

            {isOpen && (
              <div className="border-t border-neutral-800 p-4 flex flex-col gap-3">
                {g.files.map((f) => (
                  <div key={f.key} className="flex items-center gap-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-semibold ${
                        f.filename === 'output.ply'
                          ? 'bg-emerald-950 text-emerald-400'
                          : f.filename === 'output.splat'
                          ? 'bg-sky-950 text-sky-400'
                          : 'bg-neutral-800 text-neutral-400'
                      }`}
                    >
                      {f.filename}
                    </span>
                    <span className="text-neutral-500 text-xs">{formatBytes(f.size)}</span>
                    <span className="text-neutral-600 text-xs">
                      {new Date(f.lastModified).toLocaleString()}
                    </span>
                    <div className="ml-auto flex items-center gap-3">
                      {f.filename === 'output.ply' && (
                        <button
                          onClick={() => onViewPly(`/api/admin-s3/proxy?key=${encodeURIComponent(f.key)}`)}
                          className="text-xs text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
                        >
                          view ply
                        </button>
                      )}
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2"
                      >
                        download
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
