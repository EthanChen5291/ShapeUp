import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { requireSignedIn } from '@/lib/serverAuth';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const PLAN_CONFIG: Record<string, { amount: number; credits: number; name: string; description: string }> = {
  starter:  { amount: 99,   credits: 8,   name: '8 Haircut Generations',   description: '8 AI haircut renders — try different styles before your next cut.' },
  popular:  { amount: 499,  credits: 50,  name: '50 Haircut Generations',  description: '50 AI haircut renders — try different styles before your next cut.' },
  pro: { amount: 1499, credits: 200, name: '200 Haircut Generations', description: '200 AI haircut renders — try different styles before your next cut.' },
};

export async function POST(request: Request) {
  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;

  const origin = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';

  const body = await request.json().catch(() => ({})) as { plan?: string; returnUrl?: string };
  const planId = body.plan && PLAN_CONFIG[body.plan] ? body.plan : 'popular';
  const config = PLAN_CONFIG[planId];

  // Only allow relative paths to prevent open redirect
  const returnPath = typeof body.returnUrl === 'string' && /^\/[a-zA-Z0-9/_\-?=&]*$/.test(body.returnUrl)
    ? body.returnUrl
    : '/dashboard';

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: config.amount,
          product_data: {
            name: config.name,
            description: config.description,
            images: [`${origin}/shapeup_logo.png`],
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      clerkId: authResult.session.userId,
      plan: planId,
      credits: String(config.credits),
    },
    success_url: `${origin}${returnPath}?payment=success`,
    cancel_url:  `${origin}${returnPath}?payment=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
