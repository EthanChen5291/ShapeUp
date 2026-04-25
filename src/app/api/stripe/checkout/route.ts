import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Sign in to purchase' }, { status: 401 });
  }

  const origin = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    metadata: { clerkId: userId },
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: 500, // $5.00
          product_data: {
            name: '25 Haircut Generations',
            description: '25 3D haircut renders — try every style before your next cut.',
            images: ['https://shape-up-s3.s3.us-east-1.amazonaws.com/logo.png'],
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${origin}?payment=success`,
    cancel_url: `${origin}?payment=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
