'use client';

import { useState, useEffect, useRef } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';

// May 16 2026 midnight CDT (UTC-5)
const LAUNCH = new Date('2026-05-16T05:00:00Z');

function getCountdown() {
  const diff = Math.max(0, LAUNCH.getTime() - Date.now());
  return {
    days:    Math.floor(diff / 86400000),
    hours:   Math.floor((diff / 3600000) % 24),
    minutes: Math.floor((diff / 60000) % 60),
    seconds: Math.floor((diff / 1000) % 60),
  };
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function FlipDigit({ ch }: { ch: string }) {
  const prevRef = useRef(ch);
  const [anim, setAnim] = useState<{ from: string; to: string; active: boolean }>({
    from: ch, to: ch, active: false,
  });

  useEffect(() => {
    if (ch !== prevRef.current) {
      const old = prevRef.current;
      prevRef.current = ch;
      setAnim({ from: old, to: ch, active: true });
    }
  }, [ch]);

  useEffect(() => {
    if (!anim.active) return;
    const t = setTimeout(() => setAnim(s => ({ ...s, active: false })), 350);
    return () => clearTimeout(t);
  }, [anim.active, anim.from, anim.to]);

  return (
    <span
      style={{
        display: 'inline-block',
        position: 'relative',
        overflow: 'hidden',
        width: '0.58em',
        height: '1em',
        verticalAlign: 'top',
      }}
    >
      {!anim.active ? (
        <span style={{ position: 'absolute', inset: 0, textAlign: 'center', lineHeight: 1 }}>
          {ch}
        </span>
      ) : (
        <>
          <span
            key={`out-${anim.from}-${anim.to}`}
            className="flip-digit-out"
            style={{ position: 'absolute', inset: 0, textAlign: 'center', lineHeight: 1 }}
          >
            {anim.from}
          </span>
          <span
            key={`in-${anim.from}-${anim.to}`}
            className="flip-digit-in"
            style={{ position: 'absolute', inset: 0, textAlign: 'center', lineHeight: 1 }}
          >
            {anim.to}
          </span>
        </>
      )}
    </span>
  );
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  const s = pad2(value);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div
        className="type-chonk text-[var(--cream)]"
        style={{ fontSize: 'clamp(3rem, 9vw, 6.5rem)', display: 'flex', lineHeight: 1 }}
      >
        <FlipDigit ch={s[0]} />
        <FlipDigit ch={s[1]} />
      </div>
      <span
        className="font-mono text-[var(--cream)]"
        style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', opacity: 0.55 }}
      >
        {label}
      </span>
    </div>
  );
}

export function WaitlistPage() {
  const [time, setTime] = useState(getCountdown());
  const [email, setEmail] = useState('');
  const [notify, setNotify] = useState(true);
  const [hp, setHp] = useState(''); // honeypot — must stay empty
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'dupe' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const joinWaitlist = useMutation(api.waitlist.joinWaitlist);

  useEffect(() => {
    const id = setInterval(() => setTime(getCountdown()), 1000);
    return () => clearInterval(id);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('loading');
    setErrorMsg('');
    try {
      const result = await joinWaitlist({ email: email.trim(), notifyOnRelease: notify, hp });
      setStatus(result === 'already_joined' ? 'dupe' : 'done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setErrorMsg(msg || 'Something went wrong — try again.');
      setStatus('error');
    }
  };

  return (
    <main className="relative min-h-screen bg-tomato-shop overflow-hidden flex flex-col">
      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-end px-8 pt-6 pb-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--cream)] opacity-50">
          est. 2026
        </span>
      </div>

      {/* Center */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-10 gap-8">
        {/* Countdown */}
        <div className="anim-fade-up flex items-start gap-3 md:gap-5">
          <CountdownUnit value={time.days} label="days" />
          <span
            className="type-chonk text-[var(--butter)]"
            style={{ fontSize: 'clamp(3rem, 9vw, 6.5rem)', lineHeight: 1, opacity: 0.4 }}
          >
            :
          </span>
          <CountdownUnit value={time.hours} label="hrs" />
          <span
            className="type-chonk text-[var(--butter)]"
            style={{ fontSize: 'clamp(3rem, 9vw, 6.5rem)', lineHeight: 1, opacity: 0.4 }}
          >
            :
          </span>
          <CountdownUnit value={time.minutes} label="min" />
          <span
            className="type-chonk text-[var(--butter)]"
            style={{ fontSize: 'clamp(3rem, 9vw, 6.5rem)', lineHeight: 1, opacity: 0.4 }}
          >
            :
          </span>
          <CountdownUnit value={time.seconds} label="sec" />
        </div>

        {/* Opens badge */}
        <div className="anim-fade-up delay-100">
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full"
            style={{
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid rgba(255,248,234,0.2)',
            }}
          >
            <span
              className="dot-open"
              style={{ background: 'var(--butter)', boxShadow: '0 0 0 3px rgba(255,231,176,0.25)' }}
            />
            <span className="font-sans text-[11px] uppercase tracking-[0.18em] text-[var(--cream)]">
              Opens May 16th
            </span>
          </div>
        </div>

        {/* Form ticket */}
        <div className="anim-fade-up delay-200 w-full max-w-sm">
          <div className="ticket-modern ticket-on-tomato">
            {status === 'done' || status === 'dupe' ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <span style={{ fontSize: 36 }}>✂</span>
                <p
                  className="font-display italic text-2xl text-[var(--ink)]"
                  style={{ fontWeight: 500 }}
                >
                  {status === 'dupe' ? "Already on the list!" : "You're on the list!"}
                </p>
                <p className="font-serif text-[var(--char)] text-sm">
                  {status === 'dupe'
                    ? "We've got your spot. See you May 16th."
                    : "Your chair's reserved. We'll see you May 16th."}
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                {/* Honeypot — hidden from real users, bots fill it in */}
                <input
                  type="text"
                  value={hp}
                  onChange={e => setHp(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
                />
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--smoke)] mb-1">
                    Reserve your chair
                  </div>
                  <h2
                    className="font-display italic text-2xl text-[var(--ink)]"
                    style={{ fontWeight: 500 }}
                  >
                    Join the waitlist
                  </h2>
                </div>

                <input
                  type="email"
                  required
                  placeholder="your@email.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="input-soft w-full px-4 py-3 text-sm"
                  style={{ borderRadius: 12, fontStyle: 'italic' }}
                />

                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <div className="relative mt-0.5 flex-shrink-0" style={{ width: 20, height: 20 }}>
                    <input
                      type="checkbox"
                      checked={notify}
                      onChange={e => setNotify(e.target.checked)}
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                    />
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 5,
                        background: notify ? 'var(--tomato)' : 'transparent',
                        border: `2px solid ${notify ? 'var(--tomato)' : 'rgba(42,32,26,0.25)'}`,
                        transition: 'all 150ms ease',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {notify && (
                        <svg width="11" height="8" viewBox="0 0 11 8" fill="none">
                          <path
                            d="M1 4L4 7L10 1"
                            stroke="white"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </div>
                  </div>
                  <span className="font-sans text-sm text-[var(--char)]" style={{ lineHeight: 1.4 }}>
                    Notify me upon release
                  </span>
                </label>

                {status === 'error' && (
                  <p className="font-mono text-xs" style={{ color: 'var(--cherry)' }}>
                    {errorMsg}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="btn btn-ink w-full"
                  style={{ fontSize: 13, padding: '12px 20px', borderRadius: 9999 }}
                >
                  {status === 'loading' ? 'Saving your spot…' : 'Join the Waitlist ✦'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="relative z-10 border-t border-[var(--cream)]/15">
        <div className="mx-auto max-w-7xl px-8 py-5 flex flex-wrap items-center justify-between gap-4">
          <span
            className="font-display italic text-[var(--cream)] text-lg"
            style={{ fontWeight: 500 }}
          >
            the barber won&rsquo;t charge you twice for thinking twice
          </span>
          <div className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--cream)]/70">
            <span>nomorebadhaircuts.com</span>
            <span>·</span>
            <span>May 16th, 2026</span>
            <span>·</span>
            <a
              href="mailto:shapeup.ai@gmail.com"
              className="hover:text-[var(--cream)] transition-colors"
              style={{ textDecoration: 'none' }}
            >
              questions? shapeup.ai@gmail.com
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
