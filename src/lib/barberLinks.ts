// The barber-card link rules are defined server-side (the server is the
// authority on what becomes an href on a page we host) and re-exported here so
// the builder's live preview validates against exactly the same code that
// `barberPages.upsert` will run. See convex/lib/barberLinks.ts.
export {
  LINK_KINDS,
  LINK_META,
  MAX_LABEL_LENGTH,
  MAX_LINKS,
  MAX_STYLES,
  SLUG_RE,
  isLinkKind,
  isSafeLinkUrl,
  normalizeBarberLink,
  normalizeSlug,
  suggestSlug,
} from '@convex/lib/barberLinks';

export type {
  LinkKind,
  NormalizeResult,
  NormalizedLink,
  SlugCheck,
} from '@convex/lib/barberLinks';
