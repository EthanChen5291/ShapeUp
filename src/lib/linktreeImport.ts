// ============================================================
// Linktree (and Linktree-shaped link-in-bio) import.
//
// A barber who already has a Linktree shouldn't have to retype their name, bio,
// and every link into the card builder. Given the HTML of a public Linktree
// page we pull the structured data Linktree ships in its `__NEXT_DATA__` blob
// and turn it into the same {kind, value, label} rows the builder uses.
//
// Pure — no network, no Convex, no DOM. The API route does the (SSRF-guarded)
// fetch and hands the HTML string in here; that keeps this file unit-testable
// and keeps the fetch policy in one place.
// ============================================================

import { LINK_KINDS, type LinkKind } from '@convex/lib/barberLinks';

/** A single builder link row, matching the shape the barber form edits. */
export interface ImportedLinkRow {
  kind: LinkKind;
  value: string;
  label: string; // only rendered when kind === 'custom', but always carried
}

export interface LinktreeImport {
  displayName?: string;
  bio?: string;
  links: ImportedLinkRow[];
}

// Defensive bounds — the JSON blob is attacker-influenced (any barber can point
// us at any Linktree), so walking it can't be unbounded.
const MAX_WALK_DEPTH = 8;
const MAX_RAW_LINKS = 60;

type RawLink = { title: string; url: string };

/** Pull the `__NEXT_DATA__` JSON Linktree embeds, tolerant of parse failure. */
function extractNextData(html: string): unknown {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/** `<meta property="og:x" content="y">` fallback when there's no JSON blob. */
function metaContent(html: string, property: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
    'i',
  );
  const m = html.match(re);
  return m ? decodeEntities(m[1]).trim() || undefined : undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** First object anywhere in the tree that carries a string `username`. */
function findAccount(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > MAX_WALK_DEPTH || !isRecord(node)) return null;
  if (typeof node.username === 'string') return node;
  for (const value of Object.values(node)) {
    if (isRecord(value)) {
      const found = findAccount(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Collect every {title, url} pair reachable in the tree, deduped by URL. */
function collectLinks(node: unknown, out: RawLink[], seen: Set<string>, depth = 0): void {
  if (depth > MAX_WALK_DEPTH || out.length >= MAX_RAW_LINKS || !isRecord(node)) return;

  const url = node.url;
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    const key = url.toLowerCase().replace(/\/+$/, '');
    if (!seen.has(key)) {
      const title =
        typeof node.title === 'string' && node.title.trim()
          ? node.title.trim()
          : typeof node.type === 'string'
            ? node.type.trim()
            : '';
      seen.add(key);
      out.push({ title, url });
    }
  }

  for (const value of Object.values(node)) {
    if (isRecord(value)) collectLinks(value, out, seen, depth + 1);
  }
}

// Booking platforms barbers actually use — detected so they land as the styled
// "Book an appointment" button rather than a plain link.
const BOOKING_HOST_RE =
  /(^|\.)(booksy\.com|squareup\.com|square\.site|calendly\.com|acuityscheduling\.com|fresha\.com|getsquire\.com|schedulicity\.com|vagaro\.com|setmore\.com|styleseat\.com|booqable\.com)$/i;

const SOCIAL_HOST_KIND: Array<[RegExp, LinkKind]> = [
  [/(^|\.)instagram\.com$/i, 'instagram'],
  [/(^|\.)tiktok\.com$/i, 'tiktok'],
  [/(^|\.)venmo\.com$/i, 'venmo'],
  [/(^|\.)cash\.app$/i, 'cashapp'],
];

/**
 * Map one raw link to a builder row. Known socials/payments/booking get their
 * dedicated kind (the builder then names + normalizes them); everything else
 * stays a `custom` row so the barber's own link title survives the import.
 */
export function classifyImportedLink(link: RawLink): ImportedLinkRow {
  let host = '';
  try {
    host = new URL(link.url).hostname.toLowerCase();
  } catch {
    // Non-parseable URLs fall through to a custom row.
  }

  for (const [re, kind] of SOCIAL_HOST_KIND) {
    if (re.test(host)) return { kind, value: link.url, label: '' };
  }
  if (BOOKING_HOST_RE.test(host)) {
    return { kind: 'booking', value: link.url, label: '' };
  }

  const label = link.title || host.replace(/^www\./, '') || 'Link';
  return { kind: 'custom', value: link.url, label };
}

/** Parse a Linktree page's HTML into importable builder fields. */
export function parseLinktreeHtml(html: string): LinktreeImport {
  const data = extractNextData(html);

  let displayName: string | undefined;
  let bio: string | undefined;
  const rawLinks: RawLink[] = [];

  if (data) {
    const account = findAccount(data);
    if (account) {
      const pageTitle = typeof account.pageTitle === 'string' ? account.pageTitle.trim() : '';
      const username = typeof account.username === 'string' ? account.username.trim() : '';
      displayName = pageTitle || username || undefined;
      if (typeof account.description === 'string' && account.description.trim()) {
        bio = account.description.trim();
      }
    }
    collectLinks(data, rawLinks, new Set());
  }

  // Meta-tag fallback for name/bio when the JSON blob is missing or partial.
  if (!displayName) {
    const og = metaContent(html, 'og:title') ?? metaContent(html, 'twitter:title');
    // Linktree's og:title is usually "Name | Linktree" — keep the name part.
    displayName = og?.split('|')[0].trim() || undefined;
  }
  if (!bio) {
    bio = metaContent(html, 'og:description') ?? metaContent(html, 'description');
  }

  const links = rawLinks
    .map(classifyImportedLink)
    // Drop links pointing back at Linktree itself (share/app-store chrome).
    .filter((row) => {
      try {
        return !/(^|\.)linktr\.ee$/i.test(new URL(row.value).hostname);
      } catch {
        return true;
      }
    });

  return {
    displayName: displayName?.slice(0, 60),
    bio: bio?.slice(0, 240),
    links,
  };
}

/** Hosts we're willing to import from — Linktree and structurally-identical clones. */
const SUPPORTED_IMPORT_HOST_RE = /(^|\.)(linktr\.ee|linktree\.com)$/i;

export function isSupportedImportHost(hostname: string): boolean {
  return SUPPORTED_IMPORT_HOST_RE.test(hostname.toLowerCase());
}

// Referenced only so a bad refactor of LINK_KINDS trips the type-checker here
// too — classifyImportedLink must always return a real LinkKind.
export const _importableKinds: readonly LinkKind[] = LINK_KINDS;
