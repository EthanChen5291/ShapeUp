import { NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';

export async function GET() {
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  try {
    const sessions = await convex.query(api.sessions.listRecent, {});
    return NextResponse.json({ sessions });
  } catch (err) {
    console.error('admin-sessions error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
