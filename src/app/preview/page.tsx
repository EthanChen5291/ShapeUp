'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Item =
  | { type: 'video'; src: string }
  | { type: 'image'; src: string };

const SEQUENCE: Item[] = [
  { type: 'video', src: '/bear1.mp4' },
  { type: 'video', src: '/bear2.mp4' },
  { type: 'video', src: '/bear3.mp4' },
  { type: 'video', src: '/bear4.mp4' },
  { type: 'video', src: '/nikki1.mp4' },
  { type: 'video', src: '/nikki2.mp4' },
  { type: 'video', src: '/nikki3.mp4' },
  { type: 'video', src: '/nikki4.mp4' },
  { type: 'image', src: '/sarah.png' },
  { type: 'video', src: '/ian1.mp4' },
  { type: 'video', src: '/ian2.mp4' },
  { type: 'video', src: '/ian3.mp4' },
  { type: 'video', src: '/ian4.mp4' },
];

const VIDEO_ITEMS = SEQUENCE.filter((s): s is { type: 'video'; src: string } => s.type === 'video');

const fullFill: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'contain',
};

export default function PreviewPage() {
  const [index, setIndex] = useState(0);
  const activeRef = useRef(0);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const imageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const switchTo = useCallback((newIdx: number) => {
    const wrapped = ((newIdx % SEQUENCE.length) + SEQUENCE.length) % SEQUENCE.length;
    const videos = videoRefs.current;
    const prevSeq = SEQUENCE[activeRef.current];
    const nextSeq = SEQUENCE[wrapped];

    if (imageTimerRef.current) {
      clearTimeout(imageTimerRef.current);
      imageTimerRef.current = null;
    }

    if (prevSeq?.type === 'video') {
      const prevVidIdx = VIDEO_ITEMS.findIndex(v => v.src === prevSeq.src);
      videos[prevVidIdx]?.pause();
    }

    if (nextSeq?.type === 'video') {
      const nextVidIdx = VIDEO_ITEMS.findIndex(v => v.src === nextSeq.src);
      const el = videos[nextVidIdx];
      if (el) {
        el.currentTime = 0;
        el.play().catch(() => {});
      }
    } else if (nextSeq?.type === 'image') {
      imageTimerRef.current = setTimeout(() => switchTo(wrapped + 1), 3000);
    }

    // Preload the video after next so it's buffered before it needs to play.
    const afterNextSeq = SEQUENCE[(wrapped + 1) % SEQUENCE.length];
    if (afterNextSeq?.type === 'video') {
      const afterNextVidIdx = VIDEO_ITEMS.findIndex(v => v.src === afterNextSeq.src);
      const el = videos[afterNextVidIdx];
      if (el && el.preload === 'none') {
        el.preload = 'auto';
        el.load();
      }
    }

    activeRef.current = wrapped;
    setIndex(wrapped);
  }, []);

  useEffect(() => {
    const first = SEQUENCE[0];
    if (first?.type === 'video') {
      const vidIdx = VIDEO_ITEMS.findIndex(v => v.src === first.src);
      videoRefs.current[vidIdx]?.play().catch(() => {});
    }
    return () => {
      if (imageTimerRef.current) clearTimeout(imageTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') switchTo(activeRef.current + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [switchTo]);

  const currentItem = SEQUENCE[index];

  return (
    <div style={{
      background: '#000',
      width: '100vw',
      height: '100vh',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* 80% scale container — centered via transform-origin */}
      <div style={{
        position: 'absolute',
        inset: 0,
        transform: 'scale(0.8)',
        transformOrigin: 'center center',
      }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          {VIDEO_ITEMS.map((item, vidIdx) => {
            const seqIdx = SEQUENCE.findIndex(s => s.src === item.src);
            return (
              <video
                key={item.src}
                ref={el => { videoRefs.current[vidIdx] = el; }}
                src={item.src}
                muted
                playsInline
                preload={vidIdx < 2 ? 'auto' : 'none'}
                onEnded={() => { if (seqIdx === activeRef.current) switchTo(activeRef.current + 1); }}
                style={{
                  ...fullFill,
                  opacity: seqIdx === index ? 1 : 0,
                }}
              />
            );
          })}

          {currentItem?.type === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={currentItem.src}
              src={currentItem.src}
              alt=""
              style={fullFill}
            />
          )}
        </div>
      </div>

      <div style={{
        position: 'absolute',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        color: 'rgba(255,255,255,0.35)',
        fontFamily: 'monospace',
        fontSize: 12,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}>
        {index + 1} / {SEQUENCE.length} — Enter to advance
      </div>
    </div>
  );
}
