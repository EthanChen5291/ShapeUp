'use client';

// The pitch page the mirror-card footer and any outbound marketing point at.
// One job: get a barber to go build a card. Everything here argues that the
// try-on — not the link page — is what earns the QR its place on the mirror.

import Link from 'next/link';
import { LogoHomeLink, Reveal } from '@/components/AppUI';
import { useT } from '@/lib/i18n';

const STEPS = [
  {
    n: '1',
    title: 'Claim your link',
    body: 'Pick your name — tryshapeup.cc/b/you. Add booking, Instagram, Venmo, call and text. Free, forever.',
  },
  {
    n: '2',
    title: 'Add the cuts you do',
    body: 'Choose your go-to styles. Clients tap one and see it on their own head — before you pick up the clippers.',
  },
  {
    n: '3',
    title: 'Tape the QR to your mirror',
    body: 'Print the card. Every client in your chair scans it, shows you exactly what they want, and lands on your page.',
  },
];

export default function ForBarbersPage() {
  const t = useT();
  return (
    <div className="bg-shop" style={{ minHeight: '100dvh' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '18px 24px',
          maxWidth: 1080,
          margin: '0 auto',
        }}
      >
        <LogoHomeLink />
        <Link
          href="/barber"
          className="btn btn-tomato"
          style={{ textDecoration: 'none', fontSize: 14 }}
        >
          {t('Build your card')}
        </Link>
      </header>

      <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 24px 80px' }}>
        <Reveal>
          <p
            className="font-mono"
            style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--tomato)', textAlign: 'center', marginBottom: 14 }}
          >
            {t('Free for barbers')}
          </p>
          <h1
            className="font-display"
            style={{ fontSize: 'clamp(2.2rem, 7vw, 3.4rem)', fontWeight: 800, lineHeight: 1.05, textAlign: 'center', color: 'var(--ink)', margin: '0 0 18px' }}
          >
            {t('Your clients stop describing the cut.')}{' '}
            <span style={{ fontStyle: 'italic', color: 'var(--tomato)' }}>{t('They show you.')}</span>
          </h1>
          <p
            className="font-sans"
            style={{ fontSize: 18, lineHeight: 1.6, color: 'var(--char)', textAlign: 'center', maxWidth: 560, margin: '0 auto 32px' }}
          >
            {t('A free page for your chair — booking, socials, Venmo, all in one link — with a fitting room built in. A client scans the QR on your mirror, taps a cut, and sees it on their own head. No more “a little off the top.”')}
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
            <Link href="/barber" className="btn btn-tomato" style={{ textDecoration: 'none', fontSize: 15 }}>
              {t('Build your card — free')}
            </Link>
          </div>
        </Reveal>

        <div style={{ display: 'grid', gap: 16, marginTop: 56 }}>
          {STEPS.map((step, i) => (
            <Reveal key={step.n} delay={i * 90} wonk={[-0.5, 0.5, -0.4][i]}>
              <div className="stat-card" style={{ display: 'flex', gap: 18, alignItems: 'flex-start', textAlign: 'left' }}>
                <div
                  className="font-display"
                  style={{ flexShrink: 0, width: 46, height: 46, borderRadius: '50%', background: 'var(--tomato)', color: 'var(--cream)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 22 }}
                >
                  {step.n}
                </div>
                <div>
                  <h2 className="font-display" style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', margin: '2px 0 6px' }}>
                    {t(step.title)}
                  </h2>
                  <p className="font-sans" style={{ fontSize: 15.5, lineHeight: 1.6, color: 'var(--char)', margin: 0 }}>
                    {t(step.body)}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120}>
          <div
            style={{ marginTop: 48, padding: '32px 28px', borderRadius: 22, background: 'var(--cream)', border: '1.5px solid rgba(217,78,58,0.28)', textAlign: 'center', boxShadow: 'var(--shadow-md)' }}
          >
            <h2 className="font-display" style={{ fontSize: 24, fontWeight: 800, fontStyle: 'italic', color: 'var(--tomato)', margin: '0 0 8px' }}>
              {t('It’s the free tool your clients actually want.')}
            </h2>
            <p className="font-sans" style={{ fontSize: 15.5, lineHeight: 1.6, color: 'var(--char)', maxWidth: 520, margin: '0 auto 22px' }}>
              {t('Every client who scans your QR and signs up is tracked back to you. Watch it on your dashboard.')}
            </p>
            <Link href="/barber" className="btn btn-tomato" style={{ textDecoration: 'none', fontSize: 15 }}>
              {t('Get started')}
            </Link>
          </div>
        </Reveal>
      </main>
    </div>
  );
}
