// POST /api/phone-bonus/claim — grant the one-time +5 phone-verification bonus.
//
// The browser attaches + verifies a phone through Clerk's own SMS-OTP flow
// (secure, rate-limited, OTP-gated — we never see or handle the code). This
// route is the trust boundary: it re-checks against Clerk's *backend* that the
// signed-in account actually owns a VERIFIED phone number before crediting, so
// a client can't fake it by calling Convex directly. The Convex mutation is
// additionally gated by a shared secret only this server route holds.

import { NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { ConvexError } from 'convex/values';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import { requireSignedIn } from '@/lib/serverAuth';
import { hashIdentifier } from '@/lib/rateLimit';

export async function POST() {
  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;

  const secret = process.env.PHONE_BONUS_SECRET;
  if (!secret) {
    console.error('[phone-bonus] PHONE_BONUS_SECRET is not set — refusing to grant');
    return NextResponse.json({ error: 'Phone bonus is not configured' }, { status: 500 });
  }

  // Authoritative check: read the phone straight from Clerk's backend, not from
  // any client-provided value or a possibly-stale JWT claim.
  let verifiedPhone: string | null = null;
  try {
    const client = await clerkClient();
    const clerkUser = await client.users.getUser(authResult.session.userId);
    const verified = clerkUser.phoneNumbers.find(
      (p) => p.verification?.status === 'verified' && !!p.phoneNumber,
    );
    verifiedPhone = verified?.phoneNumber ?? null;
  } catch (err) {
    console.error('[phone-bonus] Clerk lookup failed', {
      user: hashIdentifier(authResult.session.userId),
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Couldn't verify your phone. Please try again." }, { status: 502 });
  }

  if (!verifiedPhone) {
    return NextResponse.json(
      { error: 'Add and verify a phone number first to claim your bonus.', code: 'phone_unverified' },
      { status: 400 },
    );
  }

  const convexToken = await authResult.session.getToken({ template: 'convex' });
  if (!convexToken) {
    return NextResponse.json({ error: 'Convex auth token unavailable' }, { status: 401 });
  }
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(convexToken);

  try {
    // Normalise before hashing so trivial formatting differences can't dodge
    // the one-bonus-per-number rule (Clerk stores E.164, but be defensive).
    const phoneHash = hashIdentifier(verifiedPhone.replace(/[^\d+]/g, ''));
    const result = await convex.mutation(api.phoneBonus.claimPhoneBonus, { secret, phoneHash });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ConvexError) {
      const data = (err.data && typeof err.data === 'object')
        ? (err.data as { code?: string; message?: string })
        : { message: typeof err.data === 'string' ? err.data : err.message };
      const status = data.code === 'phone_used' ? 409 : 400;
      return NextResponse.json({ error: data.message ?? err.message, code: data.code }, { status });
    }
    console.error('[phone-bonus] grant failed', {
      user: hashIdentifier(authResult.session.userId),
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Couldn't grant your bonus. Please try again." }, { status: 502 });
  }
}
