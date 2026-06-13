'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { ClarifyQuestion } from '@/lib/orderClarify';

const FADE_IMAGES: Record<string, string> = {
  skin: '/fade_guard_skin.png',
  half: '/fade_guard_0.5.png',
  one:  '/fade_guard_1.png',
};

const NECKLINE_IMAGES: Record<string, string> = {
  natural: '/neckline_guard_natural.png',
  squared: '/neckline_guard_square.png',
  tapered: '/neckline_guard_taper.png',
};

const IMAGE_ASSETS: Record<string, Record<string, string>> = {
  fade_bottom: FADE_IMAGES,
  neckline:    NECKLINE_IMAGES,
};

// Width of the toolbox aside in the studio page.
const TOOLBOX_W = 320; // w-80
const GAP       = 16;

interface ClarifyPanelProps {
  questions: ClarifyQuestion[];
  answers:   Record<string, string>;
  onAnswer:  (id: string, value: string) => void;
  onConfirm: () => void;
  disabled?: boolean;
}

export function ClarifyPanel({ questions, answers, onAnswer, onConfirm, disabled }: ClarifyPanelProps) {
  // Trigger the slide after the first paint so the CSS transition fires.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      // position: fixed escapes all overflow-hidden ancestors (as long as no
      // ancestor has transform/filter/perspective, which the studio layout avoids).
      // The panel slots to the LEFT of the toolbox, slides in from the right.
      style={{
        position:   'fixed',
        top:         80,
        right:       TOOLBOX_W + GAP,
        width:       316,
        maxHeight:  'calc(100vh - 108px)',
        zIndex:      35,
        overflowY:  'auto',
        // Entrance: start fully behind the toolbox, end at resting position.
        transform:   entered ? 'translateX(0)' : `translateX(calc(100% + ${GAP}px))`,
        opacity:     entered ? 1 : 0,
        transition: [
          'transform 0.52s cubic-bezier(0.16, 1, 0.3, 1)',
          'opacity   0.32s ease-out',
        ].join(', '),
        background:   'var(--biscuit-lt)',
        borderRadius:  20,
        border:       '1px solid rgba(42,32,26,0.13)',
        boxShadow:    '0 8px 48px rgba(0,0,0,0.38), 0 2px 8px rgba(0,0,0,0.18)',
        padding:      '20px 16px 16px',
      }}
      // Suppress pointer events while still animating in so fast clicks don't misfire.
      aria-live="polite"
    >
      <div className="flex flex-col gap-5">
        <span className="font-sans text-[10px] uppercase tracking-wider text-[var(--smoke)]">
          a couple quick questions
        </span>

        {questions.map((q) => {
          const value  = answers[q.id] ?? '';
          const images = IMAGE_ASSETS[q.id];
          return images
            ? <ImageQuestion   key={q.id} q={q} value={value} images={images} onAnswer={onAnswer} />
            : <TextQuestion    key={q.id} q={q} value={value}                  onAnswer={onAnswer} />;
        })}

        <button
          type="button"
          className="btn btn-tomato btn-snap"
          style={{ padding: '10px 16px', fontSize: 13 }}
          onClick={onConfirm}
          disabled={disabled}
        >
          ✂ Print my order
        </button>
      </div>
    </div>
  );
}

function ImageQuestion({ q, value, images, onAnswer }: {
  q:        ClarifyQuestion;
  value:    string;
  images:   Record<string, string>;
  onAnswer: (id: string, value: string) => void;
}) {
  const isNeckline = q.id === 'neckline';
  return (
    <div className="flex flex-col gap-3">
      <p className="font-serif italic text-sm text-[var(--ink)] leading-snug">{q.prompt}</p>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${q.options.length}, 1fr)` }}
      >
        {q.options.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onAnswer(q.id, opt.value)}
              className="flex flex-col items-center gap-2 focus:outline-none"
            >
              {/* Dark bg for transparent PNGs */}
              <div
                style={{
                  width:        '100%',
                  background:   'var(--ink)',
                  borderRadius:  14,
                  overflow:     'hidden',
                  border: isNeckline
                    ? `2.5px solid ${selected ? 'var(--tomato)' : 'rgba(217,78,58,0.4)'}`
                    : `2.5px solid ${selected ? 'var(--tomato)' : 'transparent'}`,
                  boxShadow:    selected ? '0 0 0 2px rgba(217,78,58,0.22)' : 'none',
                  transition:   'border-color 0.15s, box-shadow 0.15s',
                }}
              >
                <Image
                  src={images[opt.value]}
                  alt={opt.label}
                  width={160}
                  height={210}
                  className="w-full object-cover"
                  style={{ display: 'block' }}
                />
              </div>
              {/* Choice button — below each image */}
              <span
                className="w-full text-center rounded-lg text-[11px] font-sans font-semibold tracking-wide uppercase"
                style={{
                  padding:    '7px 4px',
                  background: selected ? 'var(--tomato)' : 'rgba(217,78,58,0.12)',
                  color:      selected ? '#fff'          : 'var(--tomato)',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TextQuestion({ q, value, onAnswer }: {
  q:        ClarifyQuestion;
  value:    string;
  onAnswer: (id: string, value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-serif italic text-sm text-[var(--ink)] leading-snug">{q.prompt}</p>
      <div className="flex flex-wrap gap-2">
        {q.options.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onAnswer(q.id, opt.value)}
              className="rounded-lg text-[11px] font-sans font-semibold tracking-wide uppercase"
              style={{
                padding:    '8px 16px',
                background: selected ? 'var(--tomato)' : 'rgba(217,78,58,0.12)',
                color:      selected ? '#fff'          : 'var(--tomato)',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
