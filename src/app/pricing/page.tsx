'use client';

import { useState } from 'react';
import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/* ── Scissors SVG (self-contained, no shared import) ── */
function ScissorsMark({ color = '#2a201a', size = 28 }: { color?: string; size?: number }) {
  return (
    <svg viewBox="0 0 200 360" xmlns="http://www.w3.org/2000/svg" style={{ width: size, height: 'auto', display: 'block' }}>
      <line x1="94" y1="188" x2="58" y2="266" stroke={color} strokeWidth="13" strokeLinecap="round" />
      <line x1="106" y1="188" x2="142" y2="266" stroke={color} strokeWidth="13" strokeLinecap="round" />
      <circle cx="52" cy="300" r="34" fill="none" stroke={color} strokeWidth="14" />
      <circle cx="148" cy="300" r="34" fill="none" stroke={color} strokeWidth="14" />
      <path d="M 108 172 L 88 188 L 32 28 L 48 22 Z" fill={color} stroke={color} strokeWidth="4" strokeLinejoin="round" />
      <path d="M 92 172 L 112 188 L 168 28 L 152 22 Z" fill={color} stroke={color} strokeWidth="4" strokeLinejoin="round" />
      <circle cx="100" cy="180" r="13" fill={color} />
    </svg>
  );
}

const PLANS = [
  {
    id: 'free',
    label: 'Free',
    price: 'Free',
    sub: 'forever',
    tokens: null as number | null,
    perToken: null as string | null,
    tokenLabel: 'Prebaked styles',
    line: 'Browse 30+ expert-curated styles rendered on your 3D scan — no generation needed, no cost ever.',
    cta: 'Start free',
    featured: false,
    freeOnly: true,
  },
  {
    id: 'starter',
    label: 'Starter',
    price: '$1.99',
    sub: 'one-time',
    tokens: 20,
    perToken: '10¢',
    tokenLabel: '20 AI looks',
    line: '20 custom renders. Enough to test a fade, a crop, and a taper before your next appointment.',
    cta: 'Try 20 looks',
    featured: false,
    freeOnly: false,
  },
  {
    id: 'popular',
    label: 'Popular',
    price: '$4.99',
    sub: 'one-time',
    tokens: 60,
    perToken: '8¢',
    tokenLabel: '60 AI looks',
    line: '60 looks to explore. Find what works for your face shape, then walk in with a reference photo.',
    cta: 'Get 60 looks',
    featured: true,
    freeOnly: false,
  },
  {
    id: 'lifetime',
    label: 'Pro',
    price: '$14.99',
    sub: 'one-time',
    tokens: 500,
    perToken: '3¢',
    tokenLabel: '500 AI looks',
    line: 'Serious about your hair. 500 looks at 3¢ each — experiment until you find a signature style.',
    cta: 'Get 500 looks',
    featured: false,
    freeOnly: false,
  },
] as const;

export default function PricingPage() {
  const { isSignedIn } = useUser();
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const handleBuy = async (planId: string) => {
    if (planId === 'free') { router.push('/'); return; }
    if (!isSignedIn) { router.push('/'); return; }
    if (loading) return;
    setLoading(planId);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      });
      const data = await res.json() as { url?: string };
      if (data.url) window.location.href = data.url;
    } finally { setLoading(null); }
  };

  return (
    <div style={{ background: 'var(--biscuit)', minHeight: '100vh', padding: '28px 40px 72px', fontFamily: 'var(--font-dmsans), system-ui, sans-serif' }}>

      {/* ── Nav ── */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 1160, margin: '0 auto 52px' }}>
        <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
          <ScissorsMark color="#2a201a" size={26} />
          <span style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontSize: 28, fontWeight: 900, color: 'var(--ink)', lineHeight: 1, letterSpacing: '-0.02em' }}>
            shape<em style={{ color: 'var(--tomato)' }}>up</em>
          </span>
        </Link>
        <Link
          href="/"
          style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontStyle: 'italic', fontSize: 15, color: 'var(--char)', opacity: 0.65, textDecoration: 'none', transition: 'opacity 140ms ease' }}
          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '0.65')}
        >
          ← back
        </Link>
      </nav>

      {/* ── Curved outer box ── */}
      <div style={{
        maxWidth: 1160, margin: '0 auto',
        borderRadius: 36,
        backgroundImage: 'url(/dark_charcoal.png)', backgroundSize: 'cover', backgroundPosition: 'center',
        border: '1px solid rgba(255,248,234,0.18)',
        boxShadow: '0 40px 100px -28px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,248,234,0.08)',
        overflow: 'hidden',
      }}>

        {/* ── Header ── */}
        <div style={{ padding: '52px 56px 52px', borderBottom: '1px solid rgba(255,248,234,0.14)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 }}>
          <h1 style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontSize: 'clamp(2.8rem, 5vw, 4.2rem)', fontWeight: 900, color: 'var(--cream)', lineHeight: 0.95, margin: 0, letterSpacing: '-0.03em' }}>
            pricing
          </h1>
          <p style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontStyle: 'italic', fontSize: 20, color: 'rgba(255,248,234,0.72)', margin: 0, maxWidth: 460, lineHeight: 1.3 }}>
            See yourself in the cut before you sit in the chair.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 4 }}>
            <div style={{
              background: 'linear-gradient(140deg, rgba(255,248,234,0.16) 0%, rgba(255,248,234,0.06) 100%)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(255,248,234,0.26)',
              borderRadius: 18, padding: '16px 32px', textAlign: 'center',
            }}>
              <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,248,234,0.62)', marginBottom: 8 }}>
                avg barber visit
              </div>
              <div style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontSize: 'clamp(1.9rem, 2.6vw, 2.6rem)', fontWeight: 900, color: 'var(--cream)', lineHeight: 1, letterSpacing: '-0.03em' }}>
                $45
              </div>
            </div>

            <div style={{ color: 'rgba(255,248,234,0.35)', fontSize: 22, lineHeight: 1 }}>→</div>

            <div style={{
              background: 'linear-gradient(140deg, rgba(82,202,120,0.22) 0%, rgba(82,202,120,0.07) 100%)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(82,202,120,0.42)',
              borderRadius: 18, padding: '16px 32px', textAlign: 'center',
            }}>
              <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(82,202,120,0.9)', marginBottom: 8 }}>
                1 AI look
              </div>
              <div style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontSize: 'clamp(1.9rem, 2.6vw, 2.6rem)', fontWeight: 900, color: '#52ca78', lineHeight: 1, letterSpacing: '-0.03em' }}>
                8¢
              </div>
            </div>
          </div>
        </div>

        {/* ── Plan cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0 }}>
          {PLANS.map((plan, i) => {
            const isLast = i === PLANS.length - 1;
            const borderRight = !isLast ? '1px solid rgba(255,248,234,0.07)' : 'none';
            const isFeatured = plan.featured;

            return (
              <div
                key={plan.id}
                style={{
                  padding: '32px 28px 36px',
                  display: 'flex', flexDirection: 'column',
                  borderRight: !isLast ? '1px solid rgba(255,248,234,0.13)' : 'none',
                  background: isFeatured ? 'rgba(255,248,234,0.08)' : 'transparent',
                  position: 'relative',
                }}
              >
                {isFeatured && (
                  <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                    background: 'var(--tomato)',
                  }} />
                )}

                {/* Plan name */}
                <div style={{
                  fontFamily: 'var(--font-jetbrains), monospace',
                  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.18em', fontWeight: 600,
                  color: isFeatured ? 'var(--tomato)' : 'rgba(255,248,234,0.58)',
                  marginBottom: 14,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  {plan.label}
                  {isFeatured && (
                    <span style={{
                      background: 'rgba(217,78,58,0.2)', color: 'var(--tomato)',
                      borderRadius: 9999, padding: '2px 8px', fontSize: 9,
                    }}>
                      popular
                    </span>
                  )}
                </div>

                {/* Price */}
                <div style={{ marginBottom: 4 }}>
                  <span style={{
                    fontFamily: 'var(--font-fraunces), Georgia, serif',
                    fontSize: 'clamp(2rem, 3vw, 2.8rem)', fontWeight: 900,
                    color: 'var(--cream)', lineHeight: 1, letterSpacing: '-0.03em',
                  }}>
                    {plan.price}
                  </span>
                </div>

                {/* Sub / per-token */}
                <div style={{
                  fontFamily: 'var(--font-jetbrains), monospace',
                  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em',
                  color: 'rgba(255,248,234,0.48)',
                  marginBottom: 20,
                }}>
                  {plan.perToken ? `${plan.perToken} / token` : plan.sub}
                </div>

                {/* Divider */}
                <div style={{ borderTop: '1px solid rgba(255,248,234,0.13)', marginBottom: 18 }} />

                {/* Token count or "free" badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    background: plan.freeOnly ? 'rgba(255,248,234,0.07)' : 'rgba(217,78,58,0.18)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <div style={{ width: 13, transform: 'rotate(186deg)' }}>
                      <ScissorsMark color={plan.freeOnly ? 'rgba(255,248,234,0.58)' : 'var(--tomato)'} size={13} />
                    </div>
                  </div>
                  <span style={{
                    fontFamily: 'var(--font-dmsans), sans-serif',
                    fontSize: 15, fontWeight: 700,
                    color: 'var(--cream)',
                  }}>
                    {plan.tokenLabel}
                  </span>
                </div>

                {/* Description */}
                <p style={{
                  fontFamily: 'var(--font-dmsans), sans-serif',
                  fontSize: 13, color: 'rgba(255,248,234,0.64)', lineHeight: 1.55,
                  margin: '0 0 24px', flex: 1,
                }}>
                  {plan.line}
                </p>

                {/* CTA */}
                <button
                  onClick={() => handleBuy(plan.id)}
                  disabled={loading === plan.id}
                  className={isFeatured ? 'btn-tomato' : ''}
                  style={{
                    width: '100%', padding: '13px 16px',
                    fontFamily: 'var(--font-dmsans), sans-serif',
                    fontSize: 13, fontWeight: 700, borderRadius: 12, cursor: 'pointer',
                    border: isFeatured ? 'none' : '1px solid rgba(255,248,234,0.18)',
                    background: isFeatured ? undefined : 'rgba(255,248,234,0.07)',
                    color: isFeatured ? undefined : 'var(--cream)',
                    transition: 'opacity 140ms ease, transform 120ms ease',
                    opacity: loading === plan.id ? 0.6 : 1,
                  }}
                  onMouseEnter={e => { if (!isFeatured) (e.currentTarget as HTMLElement).style.background = 'rgba(255,248,234,0.12)'; }}
                  onMouseLeave={e => { if (!isFeatured) (e.currentTarget as HTMLElement).style.background = 'rgba(255,248,234,0.07)'; }}
                >
                  {loading === plan.id ? '…' : plan.cta}
                </button>
              </div>
            );
          })}
        </div>

        {/* ── Footer note inside the box ── */}
        <div style={{ padding: '20px 56px 24px', borderTop: '1px solid rgba(255,248,234,0.13)', textAlign: 'center' }}>
          <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(255,248,234,0.42)' }}>
            one-time purchase · no subscription · secured by stripe
          </span>
        </div>
      </div>
    </div>
  );
}
