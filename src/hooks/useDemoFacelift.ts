'use client';

import { useEffect, useRef, useState } from 'react';

export type DemoFaceliftStatus = 'idle' | 'processing' | 'done' | 'error';

async function pollFacelift(jobId: string, outputName: string): Promise<string> {
  while (true) {
    await new Promise(r => setTimeout(r, 5000));
    const res  = await fetch(`/api/facelift?jobId=${encodeURIComponent(jobId)}&outputName=${encodeURIComponent(outputName)}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Facelift poll failed (${res.status}): ${body || 'empty response'}`);
    }
    const data = await res.json() as { status: string; splatUrl?: string; error?: string };
    if (data.status === 'success') return data.splatUrl!;
    if (data.status === 'error') throw new Error(data.error ?? 'Facelift failed');
  }
}

export function useDemoFacelift(originalImageUrl: string | null) {
  const [splatSrc, setSplatSrc] = useState<string | null>(null);
  const [status,   setStatus]   = useState<DemoFaceliftStatus>('idle');
  const [error,    setError]    = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!originalImageUrl || startedRef.current) return;
    startedRef.current = true;
    run(originalImageUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalImageUrl]);

  async function run(imageUrl: string) {
    try {
      setStatus('processing');

      const imgRes = await fetch(imageUrl);
      const blob   = await imgRes.blob();
      const imageDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const baldRes = await fetch('/api/baldify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageDataUrl }),
      });
      if (!baldRes.ok) {
        const body = await baldRes.text().catch(() => '');
        throw new Error(`Baldify failed (${baldRes.status}): ${body || 'empty response'}`);
      }
      const { baldifiedDataUrl } = await baldRes.json() as { baldifiedDataUrl?: string };
      if (!baldifiedDataUrl) throw new Error('Baldify returned no image');

      const submitRes = await fetch('/api/facelift', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageDataUrl: baldifiedDataUrl }),
      });
      if (submitRes.status === 402 || submitRes.status === 401) {
        const checkout = await fetch('/api/stripe/checkout', { method: 'POST' });
        const { url } = await checkout.json() as { url?: string };
        if (url) { window.location.href = url; return; }
      }
      if (!submitRes.ok) {
        const body = await submitRes.text().catch(() => '');
        throw new Error(`Facelift submit failed (${submitRes.status}): ${body || 'empty response'}`);
      }
      const { jobId } = await submitRes.json() as { jobId?: string };
      if (!jobId) throw new Error('No jobId from facelift');

      const splatUrl = await pollFacelift(jobId, 'original-output');
      setSplatSrc(splatUrl);
      setStatus('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[useDemoFacelift]', msg);
      setError(msg);
      setStatus('error');
    }
  }

  return { splatSrc, status, error };
}
