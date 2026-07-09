import { NextResponse } from 'next/server';
import { FREE_MODE } from '@/lib/freeMode';

export async function GET() {
  return NextResponse.json({
    // FREE_MODE (limited-time "everything free") disables the paywall app-wide.
    paywallDisabled: FREE_MODE || process.env.DISABLE_PAYWALL === '1',
  });
}
