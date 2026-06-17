import type { QueryCtx, MutationCtx } from "../_generated/server";

/**
 * Defense-in-depth admin gate for Convex functions. The /api/admin-* routes
 * already restrict callers to admins, but these queries return every user's
 * data, so they enforce admin independently here too.
 *
 * Requires `ADMIN_CLERK_IDS` to be set in the Convex deployment env (same
 * comma-separated Clerk user ids as the Vercel allowlist). `identity.subject`
 * is the Clerk user id, matching those values. Fails closed: an empty/unset
 * allowlist grants admin to nobody.
 */
export async function requireConvexAdmin(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated");

  const allowlist = (process.env.ADMIN_CLERK_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (allowlist.length === 0 || !allowlist.includes(identity.subject)) {
    throw new Error("Forbidden");
  }

  return identity;
}
