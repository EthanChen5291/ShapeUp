import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    paywallDisabled: process.env.DISABLE_PAYWALL === '1',
  });
}
