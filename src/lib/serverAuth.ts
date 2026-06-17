import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { isAdminUserId } from './adminAllowlist';

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

  // Fail closed: if ADMIN_CLERK_IDS is empty/unset, nobody is an admin.
  if (!isAdminUserId(result.session.userId)) {
    return {
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      session: null,
    };
  }

  return result;
}
