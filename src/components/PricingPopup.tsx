'use client';

import { useEffect, useState } from 'react';
import { BarberMascot, BouncyButton } from '@/components/AppUI';

function ValueBadge({ label = '2×', size = 56 }: { label?: string; size?: number }) {
  const spikes = 12, cx = 50, cy = 50, outer = 49, inner = 39;
  const points = Array.from({ length: spikes * 2 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / spikes) * i - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  return (
    <div style={{ position: 'absolute', top: -16, right: -14, width: size, height: size, zIndex: 6, pointerEvents: 'none', transform: 'rotate(12deg)', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.32))' }}>
      <svg viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <polygon points={points} fill="#e8316f" stroke="#ffffff" strokeWidth="3.5" strokeLinejoin="round" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', transform: 'rotate(-12deg)' }}>
        <span style={{ color: '#fff', fontWeight: 800, fontSize: size * 0.3, lineHeight: 1 }}>{label}</span>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: size * 0.16, lineHeight: 1, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 1 }}>value</span>
      </div>
    </div>
  );
}

function ExpandedPlanCard({ plan, loading, onBuy, staggerDelay }: {
  plan: { readonly id: string; readonly label: string; readonly price: string; readonly featured: boolean };
  loading: string | null; onBuy: (id: string) => void; staggerDelay: number;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 16); return () => clearTimeout(t); }, []);
  const springEase = 'cubic-bezier(0.34, 1.15, 0.64, 1)';
  return (
    <div style={{ position: 'relative', flex: '1 1 0', minWidth: 0, transform: ready ? 'scale(1)' : 'scale(0)', opacity: ready ? 1 : 0, transformOrigin: 'center', pointerEvents: ready ? 'auto' : 'none', transition: `transform 540ms ${springEase} ${staggerDelay}ms, opacity 300ms ease ${staggerDelay + 180}ms` }}>
      {plan.featured && <ValueBadge />}
      <BouncyButton onClick={() => onBuy(plan.id)} disabled={loading === plan.id} className={`rounded-2xl w-full ${plan.featured ? 'btn-tomato' : 'btn-cream'}`} style={{ border: plan.featured ? 'none' : '1px solid rgba(42,32,26,0.12)', padding: '20px 24px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div className="text-left">
          <div className="font-sans font-semibold" style={{ fontSize: 15 }}>{plan.label}</div>
          {plan.featured && <div className="font-mono opacity-75 mt-0.5" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Most popular</div>}
        </div>
        <div className="font-display italic" style={{ fontSize: 26, fontWeight: 700, marginTop: 16 }}>{loading === plan.id ? '…' : plan.price}</div>
      </BouncyButton>
    </div>
  );
}

const PLANS = [
  { id: 'starter', label: '8 haircut generations', price: '$1.99', featured: false },
  { id: 'popular', label: '30 haircut generations', price: '$4.99', featured: true },
  { id: 'lifetime', label: '100 haircut generations', price: '$14.99', featured: false },
] as const;

export function PricingPopup({ onDismiss, returnUrl }: { onDismiss: () => void; returnUrl?: string }) {
  const [closing, setClosing] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [expandPhase, setExpandPhase] = useState<0 | 1 | 2>(0);
  const dismiss = () => { setClosing(true); setTimeout(onDismiss, 320); };

  useEffect(() => {
    const t1 = setTimeout(() => setExpandPhase(1), 480);
    const t2 = setTimeout(() => setExpandPhase(2), 700);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

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
    } finally { setLoading(null); }
  };

  const ease = 'cubic-bezier(0.4, 0, 0.2, 1)';
  const dur = '620ms';
  const containerExpanded = expandPhase >= 1;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }}>
      <div className={closing ? 'popup-out' : 'popup-in'}>
        <div className="relative rounded-3xl flex flex-col items-center gap-5" style={{ background: 'var(--cream)', border: '1px solid rgba(42,32,26,0.1)', boxShadow: '0 30px 80px -20px rgba(0,0,0,0.45)', width: containerExpanded ? 'min(80vw, 920px)' : 360, padding: containerExpanded ? '44px 48px 48px' : '44px 40px 40px', transition: `width ${dur} ${ease}, padding ${dur} ${ease}` }}>
          <button onClick={dismiss} className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-[var(--smoke)] hover:text-[var(--ink)] hover:bg-[var(--biscuit)] transition-all text-sm">✕</button>
          <div style={{ width: 48, transform: 'rotate(186deg)' }}><BarberMascot /></div>
          <div className="text-center">
            <h2 className="font-display italic text-[var(--ink)]" style={{ fontWeight: 600, fontSize: containerExpanded ? 30 : 26, transition: `font-size ${dur} ${ease}` }}>Top up your cuts</h2>
            <p className="font-sans text-[var(--smoke)] mt-1" style={{ fontSize: containerExpanded ? 16 : 14, transition: `font-size ${dur} ${ease}` }}>Stack tokens and keep the fresh cuts coming.</p>
          </div>
          {expandPhase < 2 && (
            <div className="flex flex-col gap-3 w-full" style={{ opacity: expandPhase === 0 ? 1 : 0, transition: 'opacity 200ms ease', pointerEvents: expandPhase === 0 ? 'auto' : 'none' }}>
              {PLANS.map(plan => (
                <div key={plan.id} style={{ position: 'relative' }}>
                  {plan.featured && <ValueBadge />}
                  <BouncyButton onClick={() => handleBuy(plan.id)} disabled={loading === plan.id} className={`w-full flex items-center justify-between rounded-2xl px-5 py-4 ${plan.featured ? 'btn-tomato' : 'btn-cream'}`} style={{ border: plan.featured ? 'none' : '1px solid rgba(42,32,26,0.12)' }}>
                    <div className="text-left">
                      <div className="font-sans font-semibold" style={{ fontSize: 14 }}>{plan.label}</div>
                      {plan.featured && <div className="font-mono opacity-75 mt-0.5" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Most popular</div>}
                    </div>
                    <div className="font-display italic" style={{ fontSize: 22, fontWeight: 700 }}>{loading === plan.id ? '…' : plan.price}</div>
                  </BouncyButton>
                </div>
              ))}
            </div>
          )}
          {expandPhase === 2 && (
            <div className="flex flex-row w-full" style={{ gap: 12 }}>
              {PLANS.map((plan, i) => <ExpandedPlanCard key={plan.id} plan={plan} loading={loading} onBuy={handleBuy} staggerDelay={i * 90} />)}
            </div>
          )}
          <div style={{ width: '100%', overflow: 'hidden', maxHeight: containerExpanded ? 320 : 0, opacity: containerExpanded ? 1 : 0, borderRadius: 16, transition: `max-height 700ms ${ease} 150ms, opacity 500ms ${ease} 300ms` }}>
            <div style={{ height: 288, position: 'relative', backgroundImage: 'url(/dark_charcoal.png)', backgroundSize: 'cover', backgroundPosition: 'center', borderRadius: 16, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.10)', zIndex: 0 }} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/3face.png" alt="" style={{ position: 'absolute', top: '50%', left: 32, transform: 'translateY(-50%)', height: '173%', width: 'auto', opacity: 0.4, zIndex: 1 }} />
              <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 1, fontFamily: 'Montserrat, sans-serif', color: '#ffffff', fontSize: 104, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.04em', whiteSpace: 'nowrap' }}>Level Up Now.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
