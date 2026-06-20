/**
 * Admin allowlist parsing — pure, no Clerk/Node imports so it is safe to use
 * from both Node route handlers and the Edge middleware runtime.
 *
 * The allowlist is the comma-separated `ADMIN_CLERK_IDS` env var, each entry a
 * Clerk user id (the `userId` from `auth()`, equal to the JWT `sub` claim).
 */
export function getAdminAllowlist(): string[] {
  return (process.env.ADMIN_CLERK_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * True only when `userId` is explicitly listed. Fails closed: an empty or unset
 * allowlist grants admin to nobody.
 */
export function isAdminUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const allowlist = getAdminAllowlist();
  return allowlist.length > 0 && allowlist.includes(userId);
}
