// ============================================================
// Barber-card try-on intent.
//
// The whole promise of the QR on the mirror is: tap "burst fade" on your
// barber's card, and see *that cut* on *your* head. But between the tap and the
// studio sits a sign-up and a face scan, and the URL doesn't survive that trip.
//
// So this stashes the cut (and which barber sent them) the same way
// src/lib/referral.ts stashes `?ref=` — write it on landing, read it once the
// user finally reaches the studio, then clear it. Without this, a client who
// tapped a specific cut lands in a generic studio and the promise breaks.
//
// Sibling of referral.ts, and deliberately identical in shape.
// ============================================================

import { isHairstyleSlug } from '@/data/hairstyles';

const CUT_KEY = 'shapeup_barber_cut';
const PAGE_KEY = 'shapeup_barber_page';

export interface BarberIntent {
  /** A hairstyle slug from the catalog. */
  cut: string;
  /** The barber page (`/b/<slug>`) that sent them, if any. */
  page?: string;
}

/**
 * Read `?cut=` / `?b=` from the current URL into storage. Safe on every load.
 * Unknown cut slugs are dropped rather than stored — the value is a catalog
 * slug, and it gets used to select a chip, so it must be one we recognize.
 */
export function captureBarberIntentFromUrl(): void {
  if (typeof window === 'undefined') return;
  try {
    const params = new URLSearchParams(window.location.search);
    const cut = params.get('cut')?.trim().toLowerCase();
    if (!cut || !isHairstyleSlug(cut)) return;

    localStorage.setItem(CUT_KEY, cut);

    const page = params.get('b')?.trim().toLowerCase();
    if (page) localStorage.setItem(PAGE_KEY, page);
  } catch {
    /* storage/URL access can throw in some embedded contexts — ignore */
  }
}

/** The pending intent, if any. Does not clear it. */
export function peekBarberIntent(): BarberIntent | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const cut = localStorage.getItem(CUT_KEY);
    if (!cut || !isHairstyleSlug(cut)) return undefined;
    return { cut, page: localStorage.getItem(PAGE_KEY) ?? undefined };
  } catch {
    return undefined;
  }
}

/**
 * The pending intent, cleared as it's read — the studio applies it once, and a
 * later project shouldn't inherit a cut the user picked weeks ago.
 */
export function takeBarberCutIntent(): BarberIntent | undefined {
  const intent = peekBarberIntent();
  clearBarberIntent();
  return intent;
}

export function clearBarberIntent(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(CUT_KEY);
    localStorage.removeItem(PAGE_KEY);
  } catch {
    /* ignore */
  }
}
