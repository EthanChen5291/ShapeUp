'use client';

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

interface ClarifyPanelProps {
  questions: ClarifyQuestion[];
  answers:   Record<string, string>;
  onAnswer:  (id: string, value: string) => void;
  onConfirm: () => void;
  disabled?: boolean;
}

export function ClarifyPanel({ questions, answers, onAnswer, onConfirm, disabled }: ClarifyPanelProps) {
  return (
    <div className="flex flex-col gap-5">
      <span className="font-sans text-[10px] uppercase tracking-wider text-[var(--smoke)]">
        a couple quick questions
      </span>

      {questions.map((q) => {
        const value  = answers[q.id] ?? q.defaultValue;
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
        className="grid gap-3"
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
              {/* Image container — dark bg for transparent PNGs */}
              <div
                style={{
                  width: '100%',
                  background: 'var(--ink)',
                  borderRadius: 16,
                  overflow: 'hidden',
                  border: isNeckline
                    ? `2.5px solid ${selected ? 'var(--tomato)' : 'rgba(217,78,58,0.4)'}`
                    : `2.5px solid ${selected ? 'var(--tomato)' : 'transparent'}`,
                  boxShadow: selected ? '0 0 0 2px rgba(217,78,58,0.2)' : 'none',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
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
              {/* Button below image */}
              <span
                className="w-full text-center rounded-lg text-[11px] font-sans font-semibold tracking-wide uppercase"
                style={{
                  padding: '7px 6px',
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
