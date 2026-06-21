// Demo/dev email allowlist. Accounts whose email is in DEMO_BYPASS_EMAILS get
// paywall bypass, raised rate limits, and a higher project cap — see usages in
// users.ts (billing) and projects.ts (project cap).

export function getBypassEmails(): Set<string> {
  return new Set(
    (process.env.DEMO_BYPASS_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * True when the signed-in account is on the demo/dev email allowlist.
 * Falls back to the JWT email claim so it works even before the `users`
 * row has its email backfilled (otherwise allowlisted users with no
 * credits get charged + paywalled despite being on the list).
 */
export function isOnEmailAllowlist(
  user: { email?: string } | null,
  identity: { email?: string | null },
): boolean {
  // `||` (not `??`) so a stored empty-string email still falls back to the JWT
  // claim — otherwise an allowlisted account whose `users.email` is "" would be
  // treated as non-allowlisted and get paywalled.
  const email = user?.email || identity.email || undefined;
  return Boolean(email && getBypassEmails().has(email.toLowerCase()));
}
