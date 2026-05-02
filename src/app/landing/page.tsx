import Link from 'next/link';

function Scissors() {
  return (
    <svg viewBox="0 0 200 360" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto">
      <line x1="94" y1="188" x2="58" y2="266" stroke="currentColor" strokeWidth="13" strokeLinecap="round" />
      <line x1="106" y1="188" x2="142" y2="266" stroke="currentColor" strokeWidth="13" strokeLinecap="round" />
      <circle cx="52" cy="300" r="34" fill="none" stroke="currentColor" strokeWidth="14" />
      <circle cx="148" cy="300" r="34" fill="none" stroke="currentColor" strokeWidth="14" />
      <path d="M 108 172 L 88 188 L 32 28 L 48 22 Z" fill="currentColor" />
      <path d="M 92 172 L 112 188 L 168 28 L 152 22 Z" fill="currentColor" />
      <circle cx="100" cy="180" r="13" fill="currentColor" />
    </svg>
  );
}

export default function Landing() {
  return (
    <div className="bg-shop min-h-screen" style={{ color: 'var(--ink)' }}>

      {/* Nav */}
      <nav style={{ padding: '20px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="wordmark-inline font-sans" style={{ fontWeight: 700, fontSize: 18, letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 24, display: 'inline-block' }}><Scissors /></span>
          Shape Up
        </div>
        <Link href="/" className="btn btn-tomato" style={{ fontSize: 13 }}>Open App</Link>
      </nav>

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '80px 24px 60px', maxWidth: 640, margin: '0 auto' }}>
        <span className="pill pill-tomato" style={{ marginBottom: 20, display: 'inline-block' }}>Now in beta</span>
        <h1 className="font-display" style={{ fontSize: 'clamp(2.6rem, 7vw, 4.2rem)', lineHeight: 1.1, marginBottom: 20 }}>
          Your sharpest cut,<br />powered by AI.
        </h1>
        <p className="font-sans" style={{ fontSize: 16, color: 'var(--char)', lineHeight: 1.65, marginBottom: 36 }}>
          Scan your head in 3D, preview any style before the chair,<br />and walk in knowing exactly what you want.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/" className="btn btn-tomato" style={{ fontSize: 15, padding: '14px 28px' }}>Try it free</Link>
          <a href="#how" className="btn btn-cream" style={{ fontSize: 15, padding: '14px 28px' }}>See how it works</a>
        </div>
      </section>

      {/* Mascot */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '0 0 60px' }}>
        <div style={{ width: 80, opacity: 0.85 }}><Scissors /></div>
      </div>

      {/* Features */}
      <section id="how" style={{ maxWidth: 860, margin: '0 auto', padding: '0 24px 100px', display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {[
          { num: '01', title: 'Scan your head', body: 'Use your phone camera to capture your exact head shape and current hair in seconds.' },
          { num: '02', title: 'Explore styles', body: 'Browse AI-generated cuts rendered live on your 3D model. No guessing, no surprises.' },
          { num: '03', title: 'Walk in confident', body: 'Share the exact look with your barber — or find one nearby who can pull it off.' },
        ].map(({ num, title, body }) => (
          <div key={num} className="card" style={{ padding: '28px 24px' }}>
            <div className="pill" style={{ marginBottom: 14 }}>{num}</div>
            <h3 className="font-display" style={{ fontSize: 22, marginBottom: 10 }}>{title}</h3>
            <p className="font-sans" style={{ fontSize: 14, color: 'var(--char)', lineHeight: 1.6 }}>{body}</p>
          </div>
        ))}
      </section>

      {/* Footer */}
      <footer style={{ textAlign: 'center', padding: '24px', borderTop: '1px solid rgba(42,32,26,0.08)', fontSize: 13, color: 'var(--smoke)' }}>
        © 2025 Shape Up · Built with love in Providence
      </footer>
    </div>
  );
}
