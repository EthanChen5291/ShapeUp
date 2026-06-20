'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BarberMascot } from '@/components/AppUI';

const LD_W = 600, LD_H = 440, LD_R = 32, LD_M = 24;
const LD_SVG_W = LD_W + LD_M * 2, LD_SVG_H = LD_H + LD_M * 2;
const LD_PERIM = 2 * (LD_W + LD_H) + (2 * Math.PI - 8) * LD_R;
const LD_HALF_PERIM = LD_PERIM / 2;
const LD_DOT_OFFSET = 12;
const LD_SW = 5;
const LOAD_DURATION = 3000;

function getRoundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const cx = x + w / 2;
  return [
    `M ${cx} ${y}`,
    `H ${x + w - r}`,
    `A ${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `V ${y + h - r}`,
    `A ${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
    `H ${x + r}`,
    `A ${r} ${r} 0 0 1 ${x} ${y + h - r}`,
    `V ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    `Z`,
  ].join(' ');
}

function getRoundedRectPathCCW(x: number, y: number, w: number, h: number, r: number): string {
  const cx = x + w / 2;
  return [
    `M ${cx} ${y}`,
    `H ${x + r}`,
    `A ${r} ${r} 0 0 0 ${x} ${y + r}`,
    `V ${y + h - r}`,
    `A ${r} ${r} 0 0 0 ${x + r} ${y + h}`,
    `H ${x + w - r}`,
    `A ${r} ${r} 0 0 0 ${x + w} ${y + h - r}`,
    `V ${y + r}`,
    `A ${r} ${r} 0 0 0 ${x + w - r} ${y}`,
    `H ${cx}`,
  ].join(' ');
}

export default function LoadingScreen({ onDone, ready }: { onDone: () => void; ready: boolean }) {
  const [done, setDone] = useState(false);
  const [displayedProgress, setDisplayedProgress] = useState(0);
  const displayedRef = useRef(0);
  const isDoneRef = useRef(false);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const minElapsedRef = useRef(false);
  const completedRef = useRef(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const complete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    isDoneRef.current = true;
    setDone(true);
    setTimeout(() => onDoneRef.current(), 650);
  }, []);

  useEffect(() => {
    const tick = (ts: number) => {
      if (!startRef.current) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const rawT = Math.min(elapsed / LOAD_DURATION, 1);
      // Ease-out expo: fast at start, decelerates near end, caps at 88% until fully done
      const eased = rawT === 1 ? 0.88 : (1 - Math.pow(2, -10 * rawT)) * 0.88;
      const target = isDoneRef.current ? 1 : eased;
      const lerpRate = isDoneRef.current ? 0.1 : 0.05;
      displayedRef.current += (target - displayedRef.current) * lerpRate;
      setDisplayedProgress(displayedRef.current);
      if (displayedRef.current < 0.999) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  // Minimum animation gate — only complete once min time elapsed AND landing assets are ready
  useEffect(() => {
    const t = setTimeout(() => {
      minElapsedRef.current = true;
      if (readyRef.current) complete();
    }, LOAD_DURATION);
    return () => clearTimeout(t);
  }, [complete]);

  // Trigger completion if assets finish loading after the min time has already elapsed
  useEffect(() => {
    if (ready && minElapsedRef.current) complete();
  }, [ready, complete]);

  const pathCW = getRoundedRectPath(LD_M, LD_M, LD_W, LD_H, LD_R);
  const pathCCW = getRoundedRectPathCCW(LD_M, LD_M, LD_W, LD_H, LD_R);
  const arcLen = displayedProgress * (LD_HALF_PERIM - LD_DOT_OFFSET);

  return (
    <main className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'var(--biscuit)' }}>
      <div
        className="flex flex-col items-center gap-4"
        style={{
          position: 'relative',
          transition: 'transform 650ms cubic-bezier(.85,0,1,1)',
          transform: done ? 'translateY(-100vh)' : 'translateY(0)',
        }}
      >
        <svg
          style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: LD_SVG_W, height: LD_SVG_H, pointerEvents: 'none' }}
          viewBox={`0 0 ${LD_SVG_W} ${LD_SVG_H}`}
        >
          <path d={pathCW} fill="none" stroke="rgba(214,60,47,0.1)" strokeWidth={LD_SW} />
          <path
            d={pathCW}
            fill="none"
            stroke="var(--tomato)"
            strokeWidth={LD_SW}
            strokeLinecap="round"
            strokeDasharray={`${arcLen} ${LD_PERIM}`}
            strokeDashoffset={LD_DOT_OFFSET}
          />
          <path
            d={pathCCW}
            fill="none"
            stroke="var(--tomato)"
            strokeWidth={LD_SW}
            strokeLinecap="round"
            strokeDasharray={`${arcLen} ${LD_PERIM}`}
            strokeDashoffset={LD_DOT_OFFSET}
          />
        </svg>

        <div style={{ width: 56 }}>
          <BarberMascot snap />
        </div>
        <h1
          className="type-chonk text-[var(--ink)] select-none text-center"
          style={{ fontSize: 'clamp(4rem, 13vw, 8rem)', lineHeight: 0.9 }}
        >
          SHaPE
          <br />
          <em style={{ color: 'var(--tomato)' }}>UP</em>
        </h1>
      </div>
    </main>
  );
}
