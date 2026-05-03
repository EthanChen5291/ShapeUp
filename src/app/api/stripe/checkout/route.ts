import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST() {
  const origin = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: 499,
          product_data: {
            name: 'Haircut Generations Pack',
            description: '30 AI haircut renders — try different styles before your next cut.',
            images: [`${origin}/logo.PNG`],
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${origin}?payment=success`,
    cancel_url:  `${origin}?payment=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
