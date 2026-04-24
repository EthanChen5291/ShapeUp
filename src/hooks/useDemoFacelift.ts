'use client';

import { useEffect, useRef, useState } from 'react';

export type DemoFaceliftStatus =
  | 'idle'
  | 'baldifying'
  | 'bald-processing'
  | 'original-processing'
  | 'done'
  | 'error';

export interface DemoFaceliftState {
  baldSplatSrc:     string | null;
  originalSplatSrc: string | null;
  status:           DemoFaceliftStatus;
  error:            string | null;
}

async function pollFacelift(jobId: string, outputName: string): Promise<string> {
  while (true) {
    await new Promise(r => setTimeout(r, 5000));
    const res  = await fetch(`/api/facelift?jobId=${encodeURIComponent(jobId)}&outputName=${encodeURIComponent(outputName)}`);
    const data = await res.json() as { status: string; splatPath?: string; error?: string };
    if (data.status === 'success') return data.splatPath!;
    if (data.status === 'error') throw new Error(data.error ?? 'Facelift failed');
  }
}

export function useDemoFacelift(originalImageUrl: string | null) {
  const [baldSplatSrc,     setBaldSplatSrc]     = useState<string | null>(null);
  const [originalSplatSrc, setOriginalSplatSrc] = useState<string | null>(null);
  const [status,           setStatus]           = useState<DemoFaceliftStatus>('idle');
  const [error,            setError]            = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!originalImageUrl || startedRef.current) return;
    startedRef.current = true;
    run(originalImageUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalImageUrl]);

  async function run(imageUrl: string) {
    try {
      // ── 1. Baldify ───────────────────────────────────────────────
      setStatus('baldifying');
      const baldifyRes = await fetch('/api/baldify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageUrl }),
      });
      const { baldifiedDataUrl } = await baldifyRes.json() as { baldifiedDataUrl?: string };
      if (!baldifiedDataUrl) throw new Error('Baldify returned no image');

      // ── 2. Submit bald facelift ──────────────────────────────────
      setStatus('bald-processing');
      const baldSubmit = await fetch('/api/facelift', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageDataUrl: baldifiedDataUrl }),
      });
      const { jobId: baldJobId } = await baldSubmit.json() as { jobId?: string };
      if (!baldJobId) throw new Error('No jobId from bald facelift');

      await pollFacelift(baldJobId, 'bald-output');
      setBaldSplatSrc(`/bald-output.splat?t=${Date.now()}`);

      // ── 3. Fetch original image as data URL ──────────────────────
      setStatus('original-processing');
      const imgRes = await fetch(imageUrl);
      const blob   = await imgRes.blob();
      const originalDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      // ── 4. Submit original facelift ──────────────────────────────
      const origSubmit = await fetch('/api/facelift', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageDataUrl: originalDataUrl }),
      });
      const { jobId: origJobId } = await origSubmit.json() as { jobId?: string };
      if (!origJobId) throw new Error('No jobId from original facelift');

      await pollFacelift(origJobId, 'original-output');
      setOriginalSplatSrc(`/original-output.splat?t=${Date.now()}`);
      setStatus('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[useDemoFacelift]', msg);
      setError(msg);
      setStatus('error');
    }
  }

  return { baldSplatSrc, originalSplatSrc, status, error };
}
