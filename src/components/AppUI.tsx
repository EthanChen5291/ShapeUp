'use client';

import { useEffect, useRef, useState } from 'react';

export function ClockCounter({ value, className, style }: { value: number; className?: string; style?: React.CSSProperties }) {
  const [current, setCurrent] = useState(value);
  const [prev, setPrev] = useState<number | null>(null);
  const [animKey, setAnimKey] = useState(0);
  const currentRef = useRef(value);

  useEffect(() => {
    if (value === currentRef.current) return;
    const old = currentRef.current;
    currentRef.current = value;
    setPrev(old);
    setCurrent(value);
    setAnimKey(k => k + 1);
    const t = setTimeout(() => setPrev(null), 340);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <span className={className} style={{ position: 'relative', display: 'inline-block', overflow: 'hidden', verticalAlign: 'baseline', ...style }}>
      {prev !== null && (
        <span
          key={`out-${animKey}`}
          aria-hidden
          style={{ position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'none', animation: 'clock-digit-out 300ms cubic-bezier(0.4,0,0.6,1) forwards' }}
        >
          {prev}
        </span>
      )}
      <span key={`in-${animKey}`} style={{ display: 'block', animation: prev !== null ? 'clock-digit-in 300ms cubic-bezier(0.2,0,0.4,1) forwards' : undefined }}>
        {current}
      </span>
    </span>
  );
}

// Brand logo. Props kept for call-site compatibility; the logo is a fixed-color
// image so `color`/`snap`/`isStatic` are intentionally ignored.
export function BarberMascot(_props: { snap?: boolean; size?: 'full' | 'sm'; isStatic?: boolean; color?: string }) {
  return (
    <img
      src="/shapeup_logo.png"
      alt="ShapeUp"
      draggable={false}
      className="drop-shadow-lg scissor-mascot"
      style={{ width: '100%', height: 'auto', display: 'block', userSelect: 'none' }}
    />
  );
}

export function InlineWordmark({ cream = false, small = false }: { cream?: boolean; small?: boolean }) {
  const color = cream ? 'text-[var(--cream)]' : 'text-[var(--ink)]';
  const mascotColor = cream ? 'rgba(245,241,234,0.88)' : 'currentColor';
  const textSize = small ? 'text-[13px]' : 'text-[18px]';
  return (
    <div className={`wordmark-inline ${color} ${textSize}`}>
      <span style={{ width: small ? 20 : 28, display: 'inline-block' }}>
        <BarberMascot color={mascotColor} />
      </span>
      <span style={{ fontWeight: 700, letterSpacing: '0.06em' }}>
        Shape <span style={{ display: 'inline' }}>Up</span>
      </span>
    </div>
  );
}

export function BouncyButton({
  onClick,
  className = '',
  style,
  disabled,
  children,
}: {
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [bouncing, setBouncing] = useState(false);
  const handleClick = () => {
    if (disabled) return;
    setBouncing(true);
    setTimeout(() => setBouncing(false), 400);
    onClick?.();
  };
  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={`${className} ${bouncing ? 'btn-bouncing' : ''} transition-transform hover:scale-[1.04] active:scale-95`}
      style={style}
    >
      {children}
    </button>
  );
}

export function Reveal({
  children,
  delay = 0,
  wonk = 0,
  className = '',
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  wonk?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${shown ? 'is-revealed' : ''} ${className}`}
      style={{ '--reveal-delay': `${delay}ms`, '--reveal-wonk': `${wonk}deg`, ...style } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
