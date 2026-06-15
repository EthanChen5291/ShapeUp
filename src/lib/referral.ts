// Client-side referral-code capture. A shared link looks like
// `https://app/?ref=ABC123`; we stash the code until the visitor signs up,
// then hand it to `users.getOrCreate` which only honors it on first creation.

const STORAGE_KEY = 'shapeup_pending_ref';

/** Read `?ref=` from the current URL into storage. Safe to call on every load. */
export function captureReferralFromUrl(): void {
  if (typeof window === 'undefined') return;
  try {
    const code = new URLSearchParams(window.location.search).get('ref');
    if (code && code.trim()) {
      localStorage.setItem(STORAGE_KEY, code.trim().toUpperCase());
    }
  } catch {
    /* storage/URL access can throw in some embedded contexts — ignore */
  }
}

/** The pending referral code, if any. */
export function getPendingReferralCode(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Clear the pending code once it has been attributed (or is no longer needed). */
export function clearPendingReferralCode(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
