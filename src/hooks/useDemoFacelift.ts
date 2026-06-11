'use client';

import { useEffect, useRef, useState } from 'react';

export type DemoFaceliftStatus = 'idle' | 'processing' | 'done' | 'error';

export function useDemoFacelift(originalImageUrl: string | null) {
  const [splatSrc, setSplatSrc] = useState<string | null>(null);
  const [status,   setStatus]   = useState<DemoFaceliftStatus>('idle');
  const [error,    setError]    = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!originalImageUrl || startedRef.current) return;
    startedRef.current = true;
    run(originalImageUrl);
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

      const res = await fetch('/api/facelift', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageDataUrl, outputName: 'original-output' }),
      });

      if (res.status === 402 || res.status === 401) {
        const checkout = await fetch('/api/stripe/checkout', { method: 'POST' });
        const { url } = await checkout.json() as { url?: string };
        if (url) { window.location.href = url; return; }
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Facelift failed (${res.status}): ${body || 'empty response'}`);
      }

      const { splatUrl, error: serverError } = await res.json() as { splatUrl?: string; error?: string };
      if (serverError) throw new Error(serverError);
      if (!splatUrl) throw new Error('No splatUrl in response');

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
