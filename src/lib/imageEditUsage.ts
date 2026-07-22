import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import type { ClerkSession } from '@/lib/serverAuth';

/** Best-effort visibility counter; edit success never depends on accounting. */
export async function recordImageEditUsage(
  session: NonNullable<ClerkSession>,
): Promise<void> {
  if (typeof session.getToken !== 'function' || !process.env.NEXT_PUBLIC_CONVEX_URL) return;
  const token = await session.getToken({ template: 'convex' }).catch(() => null);
  if (!token) return;
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
  convex.setAuth(token);
  await convex.mutation(api.imageEditUsage.record, {});
}
