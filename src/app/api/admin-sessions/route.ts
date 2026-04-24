import { NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function GET() {
  try {
    const sessions = await convex.query(api.sessions.listRecent, {});
    return NextResponse.json({ sessions });
  } catch (err) {
    console.error('admin-sessions error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
