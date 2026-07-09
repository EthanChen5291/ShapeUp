'use client';

import { useEffect, useRef, useState } from 'react';
import { startCheckout } from '@/lib/checkout';
import { FREE_MODE } from '@/lib/freeMode';

export type DemoFaceliftStatus = 'idle' | 'processing' | 'done' | 'error';

export function useDemoFacelift(originalImageUrl: string | null) {
  const [splatSrc, setSplatSrc] = useState<string | null>(null);
  const [splatKey, setSplatKey] = useState<string | null>(null);
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

      if (!FREE_MODE && (res.status === 402 || res.status === 401)) {
        const url = await startCheckout({ source: 'demo_facelift_out_of_credits' });
        if (url) return;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Facelift failed (${res.status}): ${body || 'empty response'}`);
      }

      const { splatUrl, error: serverError, splatS3Key } = await res.json() as { splatUrl?: string; error?: string; splatS3Key?: string };
      if (serverError) throw new Error(serverError);
      if (!splatUrl) throw new Error('No splatUrl in response');

      setSplatSrc(splatUrl);
      if (splatS3Key) setSplatKey(splatS3Key);
      setStatus('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[useDemoFacelift]', msg);
      setError(msg);
      setStatus('error');
    }
  }

  return { splatSrc, splatKey, status, error };
}
