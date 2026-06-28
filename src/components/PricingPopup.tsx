'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BarberMascot } from '@/components/AppUI';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { startCheckout } from '@/lib/checkout';
import { useT } from '@/lib/i18n';

const PLANS = [
  {
    id: 'starter' as const,
    label: 'Starter',
    price: '$1.99',
    sub: 'one-time',
    perToken: '25¢',
    tokenLabel: '8 haircut generations',
    line: '8 custom renders. Enough to test a fade, a crop, and a taper before your next appointment.',
    cta: 'Try 8 looks',
    featured: false,
    accentColor: 'rgba(248,200,24,0.9)' as const,
    accentBg: 'rgba(248,200,24,0.18)' as const,
  },
  {
    id: 'popular' as const,
    label: 'Explorer',
    price: '$4.99',
    sub: 'one-time',
    perToken: '17¢',
    tokenLabel: '30 haircut generations',
    line: '30 looks to explore. Find what works for your face shape, then walk in with a reference photo.',
    cta: 'Get 30 looks',
    featured: true,
    accentColor: 'rgba(80,150,255,0.9)' as const,
    accentBg: 'rgba(80,150,255,0.18)' as const,
  },
  {
    id: 'pro' as const,
    label: 'Pro',
    price: '$14.99',
    sub: 'one-time',
    perToken: '15¢',
    tokenLabel: '100 haircut generations',
    line: 'Serious about your hair. 100 looks at 15¢ each — experiment until you find a signature style.',
    cta: 'Get 100 looks',
    featured: false,
    accentColor: 'rgba(240,70,130,0.9)' as const,
    accentBg: 'rgba(240,70,130,0.18)' as const,
  },
];

type PlanId = 'starter' | 'popular' | 'pro';
type PlanVariant = 'free' | PlanId;

// Prepended only when the menu is shown to people who aren't on the app yet
// (e.g. the contact page) — matches the landing page's free-plan appearance.
// The dashboard top-up menu omits it.
const FREE_PLAN = {
  id: 'free' as const,
  label: 'Free',
  price: 'Free',
  sub: 'forever',
  perToken: '',
  tokenLabel: 'Prebaked styles',
  line: 'Browse 30+ expert-curated styles rendered on your 3D scan — no generation needed, no cost ever.',
  cta: 'Start free',
  featured: false,
  accentColor: 'rgba(255,248,234,0.9)' as const,
  accentBg: 'rgba(255,248,234,0.07)' as const,
};

const POPULAR_RING_POS = [
  { x: 28, y: 30, delay: 30  },
  { x: 70, y: 68, delay: 110 },
  { x: 78, y: 26, delay: 0   },
  { x: 38, y: 74, delay: 80  },
] as const;

function PlanCTAButton({ variant, children, onClick, disabled }: {
  variant: PlanVariant;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [btnSize, setBtnSize] = useState({ w: 260, h: 46 });

  useLayoutEffect(() => {
    if (!btnRef.current) return;
    const ro = new ResizeObserver(() => {
      if (btnRef.current) setBtnSize({ w: btnRef.current.offsetWidth, h: btnRef.current.offsetHeight });
    });
    ro.observe(btnRef.current);
    return () => ro.disconnect();
  }, []);

  const onEnter = () => { setHovered(true); setAnimKey(k => k + 1); };
  const onLeave = () => setHovered(false);

  const fillColor =
    variant === 'pro' ? 'rgb(240,70,130)' :
    variant === 'popular'  ? 'rgb(80,150,255)'  :
    variant === 'starter'  ? 'rgb(248,200,24)'  :
                             'rgba(255,248,234,0.92)';

  const hoverText = (variant === 'popular' || variant === 'pro') ? '#ffffff' : 'rgba(42,32,26,0.9)';

  const baseStyle: React.CSSProperties =
    variant === 'popular'  ? { border: '1px solid rgba(55,110,210,0.5)',  background: 'rgba(55,110,210,0.22)', color: 'rgba(255,248,234,0.78)', boxShadow: '0 4px 22px rgba(55,110,210,0.18)' } :
    variant === 'pro' ? { border: '1px solid rgba(220,70,120,0.43)', background: 'rgba(220,70,120,0.05)', color: 'rgba(255,248,234,0.82)' } :
    variant === 'starter'  ? { border: '1px solid rgba(248,200,24,0.32)',  background: 'rgba(248,200,24,0.06)',  color: 'var(--cream)' } :
                             { border: '1px solid rgba(255,248,234,0.18)', background: 'rgba(255,248,234,0.07)', color: 'var(--cream)' };

  const LT_BR = 12;
  const ringColor =
    variant === 'starter'  ? 'rgba(255,238,148,0.88)' :
    variant === 'pro' ? 'rgba(255,190,218,0.88)' :
                             'rgba(255,255,255,0.85)';

  const hoverScale = variant === 'pro' ? 'scale(1.14)' : variant === 'popular' ? 'scale(1.05)' : 'scale(1.04)';
  const hoverShadow =
    variant === 'popular'  ? '0 8px 48px -2px rgba(80,150,255,0.95), 0 0 56px rgba(80,150,255,0.65)' :
    variant === 'pro' ? '0 8px 40px -4px rgba(240,70,130,0.7), 0 0 32px rgba(240,70,130,0.38)' :
    variant === 'starter'  ? '0 8px 28px -4px rgba(248,200,24,0.45), 0 0 16px rgba(248,200,24,0.24)' :
                             '0 8px 28px -4px rgba(255,248,234,0.32), 0 0 14px rgba(255,248,234,0.12)';

  return (
    <div
      style={{
        position: 'relative',
        transition: 'transform 340ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 280ms ease',
        transform: hovered ? hoverScale : 'scale(1)',
        boxShadow: hovered ? hoverShadow : undefined,
        borderRadius: LT_BR,
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <button
        ref={btnRef}
        onClick={onClick}
        disabled={disabled}
        style={{
          position: 'relative', overflow: 'hidden',
          width: '100%', padding: '13px 16px',
          fontFamily: 'var(--font-dmsans), sans-serif',
          fontSize: 13, fontWeight: 700, borderRadius: LT_BR,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          display: 'block',
          ...baseStyle,
        }}
      >
        <span aria-hidden style={{
          position: 'absolute', inset: 0,
          background: fillColor,
          clipPath: hovered ? `inset(0% round ${LT_BR - 1}px)` : 'inset(50%)',
          transition: 'clip-path 240ms cubic-bezier(0.16,1,0.3,1)',
          pointerEvents: 'none', zIndex: 0,
        }} />

        {variant === 'popular' && hovered && POPULAR_RING_POS.map((p, i) => (
          <span key={`pcircle-${animKey}-${i}`} aria-hidden style={{
            position: 'absolute', left: `${p.x}%`, top: `${p.y}%`,
            width: 2, height: 2, borderRadius: '50%',
            transform: 'translate(-50%,-50%)',
            pointerEvents: 'none', zIndex: 1,
            animation: `popular-circle-grow 780ms ${p.delay}ms cubic-bezier(0.16,1,0.3,1) forwards`,
          }} />
        ))}

        {variant === 'pro' && hovered && POPULAR_RING_POS.map((p, i) => (
          <span key={`ltcircle-${animKey}-${i}`} aria-hidden style={{
            position: 'absolute', left: `${p.x}%`, top: `${p.y}%`,
            width: 2, height: 2, borderRadius: '50%',
            transform: 'translate(-50%,-50%)',
            pointerEvents: 'none', zIndex: 1,
            animation: `pro-circle-grow 780ms ${p.delay}ms cubic-bezier(0.16,1,0.3,1) forwards`,
          }} />
        ))}

        <span style={{
          position: 'relative', zIndex: 5, display: 'block', textAlign: 'center',
          color: hovered ? hoverText : undefined,
          transition: 'color 200ms ease',
        }}>
          {children}
        </span>
      </button>

      <svg
        aria-hidden
        style={{
          position: 'absolute', top: -1, left: -1,
          width: btnSize.w + 2, height: btnSize.h + 2,
          pointerEvents: 'none', zIndex: 2, overflow: 'visible',
          opacity: hovered ? 1 : 0,
          transition: hovered ? 'opacity 40ms ease 10ms' : 'opacity 100ms ease',
        }}
      >
        <path
          d={`M ${1 + LT_BR} 1 L ${1 + btnSize.w - LT_BR} 1 A ${LT_BR} ${LT_BR} 0 0 1 ${1 + btnSize.w} ${1 + LT_BR} L ${1 + btnSize.w} ${1 + btnSize.h - LT_BR} A ${LT_BR} ${LT_BR} 0 0 1 ${1 + btnSize.w - LT_BR} ${1 + btnSize.h} L ${1 + LT_BR} ${1 + btnSize.h} A ${LT_BR} ${LT_BR} 0 0 1 1 ${1 + btnSize.h - LT_BR} L 1 ${1 + LT_BR} A ${LT_BR} ${LT_BR} 0 0 1 ${1 + LT_BR} 1 Z`}
          fill="none"
          stroke={ringColor}
          strokeWidth="2"
          pathLength={1000}
          strokeDasharray={1000}
          strokeDashoffset={hovered ? 0 : 1000}
          style={{
            transition: hovered
              ? 'stroke-dashoffset 360ms cubic-bezier(0.4, 0, 0.2, 1) 20ms'
              : 'stroke-dashoffset 195ms cubic-bezier(0.6, 0, 0.8, 0)',
          }}
        />
      </svg>
    </div>
  );
}

export function PricingPopup({ onDismiss, returnUrl, outOfTokens, interceptBuy, includeFree, onFree }: {
  onDismiss: () => void;
  returnUrl?: string;
  outOfTokens?: boolean;
  // Optional gate: return true to take over a buy (e.g. send a signed-out
  // visitor through sign-in first). Returning false/undefined proceeds to
  // checkout as normal. The dashboard omits this, so its behavior is unchanged.
  interceptBuy?: (planId: PlanId) => boolean | void;
  // Show the free tier as a 4th card (for people not on the app yet). The
  // dashboard top-up menu leaves this off.
  includeFree?: boolean;
  // What the free card's CTA does (e.g. start sign-up / enter the app).
  onFree?: () => void;
}) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 16);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    setVisible(false);
    setTimeout(onDismiss, 400);
  };

  const plans = includeFree ? [FREE_PLAN, ...PLANS] : PLANS;

  const handleBuy = async (planId: PlanId) => {
    if (loading) return;
    if (interceptBuy?.(planId)) return;
    setLoading(planId);
    try {
      await startCheckout({ plan: planId, returnUrl, source: 'pricing_popup' });
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
        padding: '16px 0 32px',
        minHeight: '100%',
        pointerEvents: 'none',
      }}>
        <div style={{
          width: '94vw',
          height: 'calc(100vh - 48px)',
          alignSelf: 'flex-start',
          pointerEvents: 'auto',
          display: 'flex',
          flexDirection: 'column',
          transform: visible ? 'translateY(0)' : 'translateY(-110%)',
          opacity: visible ? 1 : 0,
          transition: 'transform 480ms cubic-bezier(0.16, 1, 0.3, 1), opacity 300ms ease',
          ...(isMobile ? { height: 'auto', minHeight: 'calc(100vh - 48px)' } : {}),
        }}>
          <div className="pricing-led-border" style={{
            borderRadius: 36,
            backgroundImage: 'url(/dark_charcoal.png)',
            backgroundSize: '768px auto',
            backgroundRepeat: 'repeat',
            backgroundPosition: 'top left',
            overflow: 'hidden',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{
              position: 'relative',
              padding: '44px 48px 40px',
              borderBottom: '1px solid rgba(255,248,234,0.14)',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', textAlign: 'center', gap: 12,
              flexShrink: 0,
              ...(isMobile ? { padding: '40px 20px 28px' } : {}),
            }}>
              <button
                onClick={dismiss}
                style={{
                  position: 'absolute', top: 20, right: 24,
                  border: 'none', background: 'none',
                  color: 'rgba(255,248,234,0.45)',
                  cursor: 'pointer',
                  fontSize: 28, lineHeight: 1,
                  padding: '4px 8px',
                  transition: 'color 150ms ease',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,248,234,0.9)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,248,234,0.45)'; }}
              >
                ✕
              </button>

              <h2 style={{
                fontFamily: 'var(--font-fraunces), Georgia, serif',
                fontSize: 'clamp(2.4rem, 4.5vw, 3.8rem)',
                fontWeight: 900,
                color: 'var(--cream)',
                lineHeight: 0.95, margin: 0,
                letterSpacing: '-0.03em',
              }}>
                {outOfTokens ? t('out of tokens') : t('top up your cuts')}
              </h2>
              <p style={{
                fontFamily: 'var(--font-fraunces), Georgia, serif',
                fontStyle: 'italic',
                fontSize: 20,
                color: 'rgba(255,248,234,0.72)',
                margin: 0, maxWidth: 400, lineHeight: 1.35,
              }}>
                {outOfTokens
                  ? t('Get more to keep the fresh cuts coming.')
                  : t('See yourself in the cut before you sit in the chair.')}
              </p>
            </div>

            {/* Plan cards */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${plans.length}, 1fr)`,
              gap: 12,
              padding: '16px 20px 20px',
              flex: 1,
              ...(isMobile ? { gridTemplateColumns: '1fr', gap: 14 } : {}),
            }}>
              {plans.map((plan) => (
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
                    fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.18em', fontWeight: 600,
                    color: plan.featured ? 'rgba(80,150,255,0.9)' : 'rgba(255,248,234,0.58)',
                    marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {t(plan.label)}
                    {plan.featured && (
                      <span style={{
                        background: 'rgba(80,150,255,0.2)',
                        color: 'rgba(80,150,255,0.9)',
                        borderRadius: 9999, padding: '2px 8px', fontSize: 9,
                      }}>
                        {t('popular')}
                      </span>
                    )}
                  </div>

                  <div style={{ marginBottom: 4 }}>
                    <span style={{
                      fontFamily: 'var(--font-fraunces), Georgia, serif',
                      fontSize: 'clamp(2.2rem, 3vw, 3rem)', fontWeight: 900,
                      color: 'var(--cream)', lineHeight: 1, letterSpacing: '-0.03em',
                    }}>
                      {plan.price}
                    </span>
                  </div>

                  <div style={{ marginBottom: 20 }} />

                  <div style={{ borderTop: '1px solid rgba(255,248,234,0.13)', marginBottom: 16 }} />

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                      background: plan.accentBg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <img src="/shapeup_token.png" alt="token" draggable={false} style={{ width: 24, height: 24, borderRadius: '50%', display: 'block' }} />
                    </div>
                    <span style={{
                      fontFamily: 'var(--font-dmsans), sans-serif',
                      fontSize: 17, fontWeight: 700, color: 'var(--cream)',
                    }}>
                      {t(plan.tokenLabel)}
                    </span>
                  </div>

                  <p style={{
                    fontFamily: 'var(--font-dmsans), sans-serif',
                    fontSize: 14, color: 'rgba(255,248,234,0.64)', lineHeight: 1.55,
                    margin: '0 0 20px', flex: 1,
                  }}>
                    {t(plan.line)}
                  </p>

                  <PlanCTAButton
                    variant={plan.id}
                    onClick={() => (plan.id === 'free' ? onFree?.() : handleBuy(plan.id))}
                    disabled={plan.id === 'free' ? false : !!loading}
                  >
                    {loading === plan.id ? '…' : t(plan.cta)}
                  </PlanCTAButton>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div style={{
              padding: '16px 48px 20px',
              borderTop: '1px solid rgba(255,248,234,0.13)',
              textAlign: 'center',
              flexShrink: 0,
              ...(isMobile ? { padding: '16px 20px 20px' } : {}),
            }}>
              <span style={{
                fontFamily: 'var(--font-jetbrains), monospace',
                fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em',
                color: 'rgba(255,248,234,0.42)',
              }}>
                {t('one-time purchase · no subscription · secured by stripe')}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
