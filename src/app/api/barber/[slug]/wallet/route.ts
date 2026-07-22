import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import { createBarberWalletPass, isAppleWalletConfigured } from '@/lib/appleWallet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function siteOrigin(): string {
  return process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || 'https://tryshapeup.cc';
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!isAppleWalletConfigured()) {
    return Response.json({ error: 'Apple Wallet is not configured' }, { status: 503 });
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return Response.json({ error: 'Service unavailable' }, { status: 503 });

  const { slug } = await params;
  let card;
  try {
    const convex = new ConvexHttpClient(convexUrl);
    card = await convex.query(api.barberPages.getBySlug, { slug });
  } catch {
    return Response.json({ error: 'Service unavailable' }, { status: 503 });
  }
  if (!card) return Response.json({ error: 'Barber card not found' }, { status: 404 });

  try {
    const publicUrl = `${siteOrigin()}/b/${encodeURIComponent(card.slug)}`;
    const pass = await createBarberWalletPass(card, publicUrl);
    const filename = `shapeup-${card.slug}.pkpass`;
    return new Response(new Uint8Array(pass), {
      headers: {
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(pass.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[apple-wallet] pass generation failed', error);
    return Response.json({ error: 'Could not create Wallet pass' }, { status: 500 });
  }
}
