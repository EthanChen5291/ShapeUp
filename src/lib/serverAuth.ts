import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export type ClerkSession = Awaited<ReturnType<typeof auth>>;

export async function getClerkSession(): Promise<ClerkSession | null> {
  try {
    return await auth();
  } catch {
    return null;
  }
}

export async function requireSignedIn() {
  const session = await getClerkSession();
  if (!session?.userId) {
    return {
      response: NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }),
      session: null,
    };
  }
  return { response: null, session };
}

export async function requireAdmin() {
  const result = await requireSignedIn();
  if (result.response) return result;

  const allowlist = (process.env.ADMIN_CLERK_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  if (allowlist.length > 0 && !allowlist.includes(result.session.userId)) {
    return {
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      session: null,
    };
  }

  return result;
}
