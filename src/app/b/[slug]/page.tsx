// The public barber card, /b/<slug>. A server component so the card is
// server-rendered with real Open Graph tags — the whole point is a link a
// barber texts and posts, and it should preview with their name, not "ShapeUp".
//
// This is the repo's first server-side Convex read; every other one lives in a
// route handler. It's deliberately unauthenticated (no setAuth) — getBySlug is
// a public query, and the card is for logged-out strangers with phone cameras.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import BarberCard, { type BarberCardData } from '@/components/BarberCard';

export const dynamic = 'force-dynamic';

const E2E_CARD: BarberCardData = {
  slug: 'playwright-preview',
  displayName: 'Marcus Rivera',
  shopName: 'Fade Theory',
  bio: 'Precision cuts, honest recommendations.',
  location: 'Oakland, CA',
  hours: 'Tue–Sat · 10–7',
  services: [{ name: 'Signature cut', price: '$45' }],
  links: [{ kind: 'booking', label: 'Book with Marcus', url: 'https://example.com/book' }],
  styles: ['blowout-taper', 'burst-fade-textured-fringe'],
  referralCode: 'E2ETEST',
};

async function fetchCard(slug: string): Promise<BarberCardData | null> {
  // Deterministic browser coverage without seeding or mutating a developer's
  // Convex deployment. This branch is unreachable unless Playwright's server
  // opts in explicitly; production and ordinary local development query Convex.
  if (process.env.BARBER_E2E_FIXTURE === '1' && slug === E2E_CARD.slug) return E2E_CARD;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  try {
    const convex = new ConvexHttpClient(url);
    return await convex.query(api.barberPages.getBySlug, { slug });
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const card = await fetchCard(slug);
  if (!card) return { title: 'ShapeUp' };

  const who = card.shopName ? `${card.displayName} @ ${card.shopName}` : card.displayName;
  const title = `${who} | ShapeUp`;
  const description =
    card.bio || `See a haircut on your own head before ${card.displayName} touches your hair — free.`;

  return {
    title,
    description,
    openGraph: {
      title: who,
      description,
      url: `https://tryshapeup.cc/b/${card.slug}`,
    },
  };
}

export default async function BarberCardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const card = await fetchCard(slug);
  if (!card) notFound();

  return (
    // The card commits to the dark studio look regardless of the app theme —
    // the page background lives on .bc-root itself.
    <div style={{ minHeight: '100dvh', background: '#0F0F10' }}>
      <BarberCard page={card} />
    </div>
  );
}
