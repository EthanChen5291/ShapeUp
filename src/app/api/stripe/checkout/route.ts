import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST() {
  const origin = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';

  // Create a one-time 50% coupon so Stripe Checkout shows $9.99 crossed out → $4.99
  const coupon = await stripe.coupons.create({
    percent_off: 50,
    duration: 'once',
    name: 'Limited-time launch offer',
  });

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    discounts: [{ coupon: coupon.id }],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: 999,
          product_data: {
            name: 'Haircut Generations Pack',
            description: '10 AI haircut renders — try different styles before your next cut.',
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
