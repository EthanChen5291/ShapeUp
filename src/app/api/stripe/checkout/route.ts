import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { requireSignedIn } from '@/lib/serverAuth';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const PLAN_CONFIG: Record<string, { amount: number; credits: number; name: string; description: string }> = {
  starter:  { amount: 199,  credits: 20,  name: '20 Haircut Generations',  description: '20 AI haircut renders — try different styles before your next cut.' },
  popular:  { amount: 499,  credits: 60,  name: '60 Haircut Generations',  description: '60 AI haircut renders — try different styles before your next cut.' },
  lifetime: { amount: 1499, credits: 500, name: '500 Haircut Generations', description: '500 AI haircut renders — try different styles before your next cut.' },
};

export async function POST(request: Request) {
  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;

  const origin = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';

  const body = await request.json().catch(() => ({})) as { plan?: string };
  const planId = body.plan && PLAN_CONFIG[body.plan] ? body.plan : 'popular';
  const config = PLAN_CONFIG[planId];

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
            images: [`${origin}/logo.PNG`],
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
    success_url: `${origin}?payment=success`,
    cancel_url:  `${origin}?payment=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
