'use client';

import { useEffect, useState } from 'react';
import { BarberMascot } from '@/components/AppUI';

const PLANS = [
  {
    id: 'starter',
    label: 'Starter',
    price: '$1.99',
    sub: 'one-time',
    perToken: '25¢',
    tokenLabel: '8 AI looks',
    line: '8 custom renders. Enough to test a fade, a crop, and a taper before your next appointment.',
    cta: 'Try 8 looks',
    featured: false,
    accentColor: 'rgba(248,200,24,0.9)',
    accentBg: 'rgba(248,200,24,0.18)',
    border: '1px solid rgba(248,200,24,0.32)',
    bg: 'rgba(248,200,24,0.06)',
    btnColor: 'var(--cream)',
    shadow: undefined as string | undefined,
  },
  {
    id: 'popular',
    label: 'Explorer',
    price: '$4.99',
    sub: 'one-time',
    perToken: '17¢',
    tokenLabel: '30 AI looks',
    line: '30 looks to explore. Find what works for your face shape, then walk in with a reference photo.',
    cta: 'Get 30 looks',
    featured: true,
    accentColor: 'rgba(80,150,255,0.9)',
    accentBg: 'rgba(80,150,255,0.18)',
    border: '1px solid rgba(55,110,210,0.5)',
    bg: 'rgba(55,110,210,0.22)',
    btnColor: 'rgba(255,248,234,0.78)',
    shadow: '0 4px 22px rgba(55,110,210,0.18)',
  },
  {
    id: 'lifetime',
    label: 'Pro',
    price: '$14.99',
    sub: 'one-time',
    perToken: '15¢',
    tokenLabel: '100 AI looks',
    line: 'Serious about your hair. 100 looks at 15¢ each — experiment until you find a signature style.',
    cta: 'Get 100 looks',
    featured: false,
    accentColor: 'rgba(240,70,130,0.9)',
    accentBg: 'rgba(240,70,130,0.18)',
    border: '1px solid rgba(220,70,120,0.43)',
    bg: 'rgba(220,70,120,0.05)',
    btnColor: 'rgba(255,248,234,0.82)',
    shadow: undefined as string | undefined,
  },
] as const;

export function PricingPopup({ onDismiss, returnUrl, outOfTokens }: {
  onDismiss: () => void;
  returnUrl?: string;
  outOfTokens?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 16);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    setVisible(false);
    setTimeout(onDismiss, 400);
  };

  const handleBuy = async (planId: string) => {
    if (loading) return;
    setLoading(planId);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId, returnUrl }),
      });
      const data = await res.json() as { url?: string };
      if (data.url) window.location.href = data.url;
    } finally {
      setLoading(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10000] overflow-y-auto"
      style={{
        background: visible ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0)',
        transition: 'background 300ms ease',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        padding: '32px 16px 48px',
        minHeight: '100%',
        pointerEvents: 'none',
      }}>
        <div style={{
          width: 'min(92vw, 900px)',
          alignSelf: 'flex-start',
          pointerEvents: 'auto',
          transform: visible ? 'translateY(0)' : 'translateY(-110%)',
          opacity: visible ? 1 : 0,
          transition: 'transform 480ms cubic-bezier(0.16, 1, 0.3, 1), opacity 300ms ease',
        }}>
          <div className="pricing-led-border" style={{
            borderRadius: 36,
            backgroundImage: 'url(/dark_charcoal.png)',
            backgroundSize: '768px auto',
            backgroundRepeat: 'repeat',
            backgroundPosition: 'top left',
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              position: 'relative',
              padding: '44px 48px 40px',
              borderBottom: '1px solid rgba(255,248,234,0.14)',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', textAlign: 'center', gap: 12,
            }}>
              <button
                onClick={dismiss}
                style={{
                  position: 'absolute', top: 16, right: 16,
                  width: 32, height: 32, borderRadius: '50%',
                  border: '1px solid rgba(255,248,234,0.18)',
                  background: 'rgba(255,248,234,0.08)',
                  color: 'rgba(255,248,234,0.6)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13,
                  transition: 'background 150ms ease, color 150ms ease',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,248,234,0.16)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,248,234,0.9)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,248,234,0.08)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,248,234,0.6)'; }}
              >
                ✕
              </button>

              <h2 style={{
                fontFamily: 'var(--font-fraunces), Georgia, serif',
                fontSize: 'clamp(2rem, 4vw, 3.2rem)',
                fontWeight: 900,
                color: 'var(--cream)',
                lineHeight: 0.95, margin: 0,
                letterSpacing: '-0.03em',
              }}>
                {outOfTokens ? 'out of tokens' : 'top up your cuts'}
              </h2>
              <p style={{
                fontFamily: 'var(--font-fraunces), Georgia, serif',
                fontStyle: 'italic',
                fontSize: 17,
                color: 'rgba(255,248,234,0.72)',
                margin: 0, maxWidth: 400, lineHeight: 1.35,
              }}>
                {outOfTokens
                  ? 'Get more to keep the fresh cuts coming.'
                  : 'See yourself in the cut before you sit in the chair.'}
              </p>
            </div>

            {/* Plan cards */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
              padding: '16px 20px 20px',
            }}>
              {PLANS.map((plan) => (
                <div
                  key={plan.id}
                  style={{
                    padding: '24px 20px 28px',
                    display: 'flex', flexDirection: 'column',
                    borderRadius: 16,
                    border: plan.featured
                      ? '1px solid rgba(80,150,255,0.55)'
                      : '1px solid rgba(255,248,234,0.14)',
                    background: plan.featured
                      ? 'linear-gradient(160deg, rgba(255,248,234,0.1) 0%, rgba(255,248,234,0.05) 100%)'
                      : 'rgba(255,248,234,0.04)',
                    backdropFilter: 'blur(10px)',
                    WebkitBackdropFilter: 'blur(10px)',
                    boxShadow: plan.featured
                      ? '0 8px 40px rgba(80,150,255,0.18), inset 0 1px 0 rgba(255,248,234,0.13)'
                      : 'inset 0 1px 0 rgba(255,248,234,0.09)',
                    position: 'relative',
                  }}
                >
                  {plan.featured && (
                    <div style={{
                      position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                      background: 'rgba(80,150,255,0.9)',
                      borderRadius: '16px 16px 0 0',
                    }} />
                  )}

                  <div style={{
                    fontFamily: 'var(--font-jetbrains), monospace',
                    fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.18em', fontWeight: 600,
                    color: plan.featured ? 'rgba(80,150,255,0.9)' : 'rgba(255,248,234,0.58)',
                    marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {plan.label}
                    {plan.featured && (
                      <span style={{
                        background: 'rgba(80,150,255,0.2)',
                        color: 'rgba(80,150,255,0.9)',
                        borderRadius: 9999, padding: '2px 8px', fontSize: 9,
                      }}>
                        popular
                      </span>
                    )}
                  </div>

                  <div style={{ marginBottom: 4 }}>
                    <span style={{
                      fontFamily: 'var(--font-fraunces), Georgia, serif',
                      fontSize: 'clamp(1.8rem, 2.5vw, 2.4rem)', fontWeight: 900,
                      color: 'var(--cream)', lineHeight: 1, letterSpacing: '-0.03em',
                    }}>
                      {plan.price}
                    </span>
                  </div>

                  <div style={{
                    fontFamily: 'var(--font-jetbrains), monospace',
                    fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em',
                    color: 'rgba(255,248,234,0.48)', marginBottom: 20,
                  }}>
                    {plan.perToken} / token · {plan.sub}
                  </div>

                  <div style={{ borderTop: '1px solid rgba(255,248,234,0.13)', marginBottom: 16 }} />

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                      background: plan.accentBg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <div style={{ width: 12, transform: 'rotate(186deg)' }}>
                        <BarberMascot isStatic color={plan.accentColor} />
                      </div>
                    </div>
                    <span style={{
                      fontFamily: 'var(--font-dmsans), sans-serif',
                      fontSize: 14, fontWeight: 700, color: 'var(--cream)',
                    }}>
                      {plan.tokenLabel}
                    </span>
                  </div>

                  <p style={{
                    fontFamily: 'var(--font-dmsans), sans-serif',
                    fontSize: 12, color: 'rgba(255,248,234,0.64)', lineHeight: 1.55,
                    margin: '0 0 20px', flex: 1,
                  }}>
                    {plan.line}
                  </p>

                  <button
                    onClick={() => handleBuy(plan.id)}
                    disabled={!!loading}
                    style={{
                      width: '100%',
                      padding: '11px 16px',
                      fontFamily: 'var(--font-dmsans), sans-serif',
                      fontSize: 12, fontWeight: 700,
                      borderRadius: 10,
                      cursor: loading ? 'not-allowed' : 'pointer',
                      opacity: loading === plan.id ? 0.6 : 1,
                      border: plan.border,
                      background: plan.bg,
                      color: plan.btnColor,
                      boxShadow: plan.shadow,
                      transition: 'opacity 150ms ease, transform 150ms ease',
                    }}
                    onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.03)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
                  >
                    {loading === plan.id ? '…' : plan.cta}
                  </button>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div style={{
              padding: '16px 48px 20px',
              borderTop: '1px solid rgba(255,248,234,0.13)',
              textAlign: 'center',
            }}>
              <span style={{
                fontFamily: 'var(--font-jetbrains), monospace',
                fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em',
                color: 'rgba(255,248,234,0.42)',
              }}>
                one-time purchase · no subscription · secured by stripe
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
