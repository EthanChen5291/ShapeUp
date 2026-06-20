// Minimal blocklist of common disposable / throwaway email domains. Not
// exhaustive by design — it's one cheap signal in the free-generation
// anti-abuse stack (see convex/freeGen.ts), not the whole defense. Extend as
// real abuse domains show up in logs.
const DISPOSABLE_DOMAINS = new Set<string>([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "yopmail.com",
  "trashmail.com",
  "getnada.com",
  "nada.email",
  "sharklasers.com",
  "maildrop.cc",
  "dispostable.com",
  "fakeinbox.com",
  "mintemail.com",
  "mohmal.com",
  "spam4.me",
  "tempr.email",
  "moakt.com",
]);

/** True when the email's domain is a known disposable provider (or malformed). */
export function isDisposableEmailDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain) return true; // no parseable domain → treat as untrusted
  return DISPOSABLE_DOMAINS.has(domain);
}
