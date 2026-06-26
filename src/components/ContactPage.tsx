'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { BarberMascot, BouncyButton } from '@/components/AppUI';

/* Topics mirror convex/contact.ts CONTACT_TOPICS. Each one routes the message
   internally and tells the sender we know what they're here for. */
const TOPICS = [
  { id: 'support', label: 'Help & support', hint: 'Something broke or my scan looks off' },
  { id: 'billing', label: 'Billing & refunds', hint: 'A charge, tokens, or a render I want refunded' },
  { id: 'privacy', label: 'Privacy & data', hint: 'Delete my photo or data, or a privacy question' },
  { id: 'partnership', label: 'Barbershop / partnership', hint: 'Work with us or bring ShapeUp to my shop' },
  { id: 'press', label: 'Press & media', hint: "I'm writing about ShapeUp" },
  { id: 'other', label: 'Something else', hint: 'Feedback, ideas, or anything at all' },
] as const;

type TopicId = (typeof TOPICS)[number]['id'];
type Status = 'idle' | 'loading' | 'done' | 'error';

/* Self-serve shortcuts. Many people clicking "contact us" actually want one of
   these — surfacing them up front gets them an answer faster than waiting on a
   reply, and keeps the inbox for things that genuinely need us. */
const QUICK_LINKS: { label: string; desc: string; href: string }[] = [
  { label: 'Refund a render', desc: 'Not happy with a 3D model? Request tokens back from the studio.', href: '/dashboard' },
  { label: 'Delete my data', desc: 'Wipe your photo, scans, and account whenever you want.', href: '/delete-my-data' },
  { label: 'Privacy policy', desc: 'Exactly what we store, and what we never do with it.', href: '/privacy' },
  { label: 'Pricing & plans', desc: 'What a scan costs and what each plan includes.', href: '/pricing' },
];

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: 'How fast will I hear back?',
    a: <>We read everything and reply within <strong>1 business day</strong>, usually much sooner. Billing and data requests jump the queue.</>,
  },
  {
    q: 'Can I get a refund?',
    a: <>Yes. If a render didn&rsquo;t come out right, open it in your <Link href="/dashboard" className="contact-inline-link">dashboard</Link> and request your tokens back, or pick &ldquo;Billing &amp; refunds&rdquo; above and tell us what happened.</>,
  },
  {
    q: 'How do I delete my photo and data?',
    a: <>Head to <Link href="/delete-my-data" className="contact-inline-link">delete my data</Link> to remove everything yourself, or message us with &ldquo;Privacy &amp; data&rdquo; selected and we&rsquo;ll handle it.</>,
  },
  {
    q: 'Do you work with barbershops?',
    a: <>We&rsquo;d love to. Choose &ldquo;Barbershop / partnership&rdquo; and tell us about your shop — we read every one of these personally.</>,
  },
];

export default function ContactPage() {
  const submitMessage = useMutation(api.contact.submitMessage);

  const [topic, setTopic] = useState<TopicId>('support');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [hp, setHp] = useState(''); // honeypot — must stay empty
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'loading') return;
    setStatus('loading');
    setErrorMsg('');
    try {
      await submitMessage({ name: name.trim(), email: email.trim(), topic, message: message.trim(), hp });
      setStatus('done');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    }
  };

  return (
    <main className="min-h-screen" style={{ background: 'var(--biscuit)', color: 'var(--ink)' }}>
      {/* Warm ambient blobs, same language as the landing hero */}
      <div
        className="pointer-events-none fixed inset-0"
        aria-hidden
        style={{
          backgroundImage:
            'radial-gradient(ellipse 700px 460px at 8% 0%, rgba(255,212,184,0.45), transparent 60%),' +
            'radial-gradient(ellipse 560px 380px at 95% 100%, rgba(107,153,191,0.12), transparent 60%)',
        }}
      />

      <div className="relative" style={{ maxWidth: 1120, margin: '0 auto', padding: '20px 24px 80px' }}>
        {/* ── Nav ── */}
        <nav className="flex items-center justify-between" aria-label="Contact">
          <Link href="/" className="flex items-center gap-2 group" style={{ textDecoration: 'none' }}>
            <div style={{ width: 40 }}><BarberMascot isStatic color="var(--ink)" /></div>
            <div className="type-chonk" style={{ fontSize: 24, lineHeight: 1, color: 'var(--ink)' }}>
              shape<em style={{ color: 'var(--tomato)' }}>up</em>
            </div>
          </Link>
          <Link
            href="/"
            className="font-mono"
            style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--smoke)', textDecoration: 'none' }}
          >
            ← back to home
          </Link>
        </nav>

        {/* ── Header ── */}
        <header style={{ textAlign: 'center', margin: '52px auto 44px', maxWidth: 620 }}>
          <p className="font-mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.18em', color: 'var(--tomato)', marginBottom: 16 }}>
            we&rsquo;re listening
          </p>
          <h1 className="type-chonk" style={{ fontSize: 'clamp(2.4rem, 5vw, 3.4rem)', lineHeight: 1.04, color: 'var(--ink)' }}>
            Talk to a <em style={{ color: 'var(--tomato)' }}>real human</em>.
          </h1>
          <p className="font-serif italic" style={{ fontSize: 18, color: 'var(--char)', maxWidth: 480, margin: '20px auto 0', lineHeight: 1.55 }}>
            Question, bug, refund, or a barbershop you want us to meet — we read every message and reply within a day.
          </p>
        </header>

        {/* ── Body: form + sidebar ── */}
        <div className="contact-grid">
          {/* Form card */}
          <section
            className="contact-card"
            aria-labelledby="contact-form-heading"
            style={{ background: 'var(--cream)', borderRadius: 20, border: '1px solid rgba(42,32,26,0.10)', padding: 'clamp(22px, 4vw, 34px)' }}
          >
            {status === 'done' ? (
              <div role="status" style={{ textAlign: 'center', padding: '36px 8px' }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(217,78,58,0.10)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--tomato)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <h2 className="type-chonk" style={{ fontSize: 26, color: 'var(--ink)', marginBottom: 10 }}>Message sent!</h2>
                <p className="font-sans" style={{ fontSize: 15, color: 'var(--char)', lineHeight: 1.6, maxWidth: 360, margin: '0 auto' }}>
                  Thanks, {name.trim().split(' ')[0] || 'friend'}. We&rsquo;ll reply to <strong>{email.trim()}</strong> within a business day.
                </p>
                <Link href="/" className="font-mono" style={{ display: 'inline-block', marginTop: 24, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--smoke)', textDecoration: 'none' }}>
                  ← back to home
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate>
                <h2 id="contact-form-heading" className="font-display" style={{ fontStyle: 'italic', fontSize: 22, color: 'var(--ink)', marginBottom: 4 }}>
                  Send us a note
                </h2>
                <p className="font-sans" style={{ fontSize: 13.5, color: 'var(--smoke)', marginBottom: 22 }}>
                  Pick what it&rsquo;s about so it reaches the right person.
                </p>

                {/* Topic chips */}
                <fieldset style={{ border: 0, padding: 0, margin: '0 0 22px' }}>
                  <legend className="font-sans" style={{ fontSize: 13, fontWeight: 600, color: 'var(--char)', marginBottom: 10 }}>
                    What can we help with?
                  </legend>
                  <div className="contact-topic-grid">
                    {TOPICS.map((t) => {
                      const active = topic === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setTopic(t.id)}
                          aria-pressed={active}
                          title={t.hint}
                          className="contact-topic-chip"
                          data-active={active}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="font-sans" style={{ fontSize: 12.5, color: 'var(--smoke)', marginTop: 10, minHeight: 18 }}>
                    {TOPICS.find((t) => t.id === topic)?.hint}
                  </p>
                </fieldset>

                {/* Name + email */}
                <div className="contact-field-row">
                  <label className="contact-field">
                    <span className="contact-label">Your name</span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      autoComplete="name"
                      maxLength={120}
                      placeholder="Alex Rivera"
                      className="contact-input"
                    />
                  </label>
                  <label className="contact-field">
                    <span className="contact-label">Email</span>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      inputMode="email"
                      placeholder="you@email.com"
                      className="contact-input"
                    />
                  </label>
                </div>

                {/* Message */}
                <label className="contact-field" style={{ marginTop: 16 }}>
                  <span className="contact-label">Message</span>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    required
                    rows={5}
                    maxLength={4000}
                    placeholder="Tell us what's up — the more detail, the faster we can help."
                    className="contact-input"
                    style={{ resize: 'vertical', minHeight: 120 }}
                  />
                  <span className="font-sans" style={{ fontSize: 11.5, color: 'var(--smoke)', alignSelf: 'flex-end', marginTop: 4 }}>
                    {message.trim().length}/4000
                  </span>
                </label>

                {/* Honeypot — visually hidden, off the a11y tree */}
                <input
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden
                  value={hp}
                  onChange={(e) => setHp(e.target.value)}
                  style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
                />

                {status === 'error' && (
                  <p role="alert" className="font-sans" style={{ fontSize: 13.5, color: 'var(--tomato)', marginTop: 16, lineHeight: 1.5 }}>
                    {errorMsg}
                  </p>
                )}

                <BouncyButton
                  type="submit"
                  disabled={status === 'loading'}
                  className="btn-tomato"
                  style={{ marginTop: 22, width: '100%', padding: '14px 22px', fontSize: 15, borderRadius: 12 }}
                >
                  {status === 'loading' ? 'Sending…' : 'Send message →'}
                </BouncyButton>

                <p className="font-sans" style={{ fontSize: 12, color: 'var(--smoke)', textAlign: 'center', marginTop: 14, lineHeight: 1.5 }}>
                  We&rsquo;ll only use your email to reply. No lists, no spam.
                </p>
              </form>
            )}
          </section>

          {/* Sidebar */}
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Direct channels */}
            <div className="contact-card" style={{ background: 'var(--ink)', borderRadius: 20, padding: '26px 24px', color: 'var(--cream)' }}>
              <p className="font-mono" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'rgba(255,248,234,0.5)', marginBottom: 16 }}>
                prefer to reach out directly?
              </p>

              <a href="mailto:shapeup.ai@gmail.com" className="contact-channel">
                <span className="contact-channel-icon" aria-hidden>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="3" />
                    <polyline points="2,4 12,13 22,4" />
                  </svg>
                </span>
                <span>
                  <span className="contact-channel-label">Email us</span>
                  <span className="contact-channel-value">shapeup.ai@gmail.com</span>
                </span>
              </a>

              <a href="https://instagram.com/unchopped_" target="_blank" rel="noopener noreferrer" className="contact-channel">
                <span className="contact-channel-icon" aria-hidden>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                    <circle cx="12" cy="12" r="4" />
                    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                  </svg>
                </span>
                <span>
                  <span className="contact-channel-label">DM us on Instagram</span>
                  <span className="contact-channel-value">@unchopped_</span>
                </span>
              </a>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18, paddingTop: 16, borderTop: '1px solid rgba(255,248,234,0.12)' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#52ca78', boxShadow: '0 0 0 3px rgba(82,202,120,0.22)', flexShrink: 0 }} />
                <span className="font-sans" style={{ fontSize: 12.5, color: 'rgba(255,248,234,0.62)', lineHeight: 1.5 }}>
                  Typically replies within a business day.
                </span>
              </div>
            </div>

            {/* Quick links — self-serve common reasons */}
            <div className="contact-card" style={{ background: 'var(--cream)', borderRadius: 20, border: '1px solid rgba(42,32,26,0.10)', padding: '22px 22px' }}>
              <p className="font-mono" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--tomato)', marginBottom: 14 }}>
                maybe this helps faster
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {QUICK_LINKS.map((l) => (
                  <Link key={l.href + l.label} href={l.href} className="contact-quick-link">
                    <span>
                      <span className="contact-quick-label">{l.label}</span>
                      <span className="contact-quick-desc">{l.desc}</span>
                    </span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="contact-quick-arrow" aria-hidden>
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </Link>
                ))}
              </div>
            </div>
          </aside>
        </div>

        {/* ── FAQ ── */}
        <section aria-labelledby="contact-faq-heading" style={{ maxWidth: 720, margin: '64px auto 0' }}>
          <h2 id="contact-faq-heading" className="type-chonk" style={{ fontSize: 'clamp(1.6rem, 3vw, 2.1rem)', textAlign: 'center', color: 'var(--ink)', marginBottom: 28 }}>
            quick <em style={{ color: 'var(--tomato)' }}>answers</em>.
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {FAQS.map((item, i) => {
              const open = openFaq === i;
              return (
                <div key={i} className="contact-faq" style={{ background: 'var(--cream)', borderRadius: 14, border: '1px solid rgba(42,32,26,0.10)', overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? null : i)}
                    aria-expanded={open}
                    className="contact-faq-q"
                  >
                    <span className="font-sans" style={{ fontWeight: 600, fontSize: 15.5, color: 'var(--ink)' }}>{item.q}</span>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--tomato)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, transform: open ? 'rotate(45deg)' : 'none', transition: 'transform 220ms cubic-bezier(.2,.85,.2,1)' }}>
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                  <div className="contact-faq-a" data-open={open}>
                    <p className="font-sans" style={{ fontSize: 14.5, color: 'var(--char)', lineHeight: 1.65, padding: '0 20px 18px' }}>
                      {item.a}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
