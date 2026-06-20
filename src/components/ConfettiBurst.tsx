'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
  shape: 'rect' | 'circle';
  life: number; // seconds elapsed
};

const COLORS = ['#E8543F', '#7B9E4A', '#F4B942', '#3A6EA5', '#E879A6', '#2A201A'];

const GRAVITY = 1300; // px/s^2
const DRAG = 0.86; // horizontal damping per second
const LIFETIME = 2.6; // seconds before a piece is gone
const FADE_START = 1.4; // when pieces begin fading out

/**
 * Fires a one-shot confetti burst from the bounding box of `originRef`.
 * Bump `fireKey` to a new truthy value to trigger another burst.
 * Pieces explode upward/outward, then fall under gravity and fade.
 */
export default function ConfettiBurst({
  fireKey,
  originRef,
}: {
  fireKey: number;
  originRef: React.RefObject<HTMLElement | null>;
}) {
  const [mounted, setMounted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number>(0);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!fireKey) return;
    const origin = originRef.current;
    const canvas = canvasRef.current;
    if (!origin || !canvas) return;

    const rect = origin.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Spawn pieces along the width of the bar, bursting upward + outward.
    const count = 90;
    const spawned: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const x = rect.left + Math.random() * rect.width;
      const y = rect.top + rect.height * 0.5;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI * 0.9); // mostly up
      const speed = 420 + Math.random() * 520;
      spawned.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 14,
        size: 6 + Math.random() * 7,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        shape: Math.random() < 0.35 ? 'circle' : 'rect',
        life: 0,
      });
    }
    particlesRef.current = spawned;
    lastTsRef.current = 0;

    const tick = (ts: number) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = Math.min((ts - lastTsRef.current) / 1000, 0.05);
      lastTsRef.current = ts;

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      const dragFactor = Math.pow(DRAG, dt);
      let alive = 0;

      for (const p of particlesRef.current) {
        p.life += dt;
        if (p.life >= LIFETIME) continue;
        alive++;
        p.vy += GRAVITY * dt;
        p.vx *= dragFactor;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;

        const alpha =
          p.life < FADE_START ? 1 : 1 - (p.life - FADE_START) / (LIFETIME - FADE_START);

        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
        }
        ctx.restore();
      }

      if (alive > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        rafRef.current = null;
      }
    };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [fireKey, originRef]);

  if (!mounted) return null;

  return createPortal(
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 2147483000,
      }}
    />,
    document.body,
  );
}
