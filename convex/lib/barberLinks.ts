// ============================================================
// Barber-card link normalization.
//
// Barbers type what they know — "@marcus", "$marcusfades", "(415) 555-0134" —
// not URLs. This turns those into real, safe hrefs.
//
// It lives under convex/ because the SERVER is the authority: whatever ends up
// in the `barberPages.links` array is rendered as an `href` on a public page we
// host, so it gets validated at write time, not just in the form. The builder
// imports the same module through the `@convex/*` alias so the live preview and
// the stored value can never disagree.
//
// Pure — no Convex imports. Safe to use from a browser bundle.
// ============================================================

export const LINK_KINDS = [
  "booking",
  "instagram",
  "tiktok",
  "venmo",
  "cashapp",
  "phone",
  "sms",
  "maps",
  "website",
  "custom",
] as const;

export type LinkKind = (typeof LINK_KINDS)[number];

export const MAX_LINKS = 10;
export const MAX_STYLES = 12;
export const MAX_LABEL_LENGTH = 40;

export function isLinkKind(value: string): value is LinkKind {
  return (LINK_KINDS as readonly string[]).includes(value);
}

/** What each kind is called on the card, and what the input asks for. */
export const LINK_META: Record<LinkKind, { label: string; placeholder: string; hint: string }> = {
  booking: { label: "Book an appointment", placeholder: "booksy.com/…", hint: "Your booking link" },
  instagram: { label: "Instagram", placeholder: "@yourhandle", hint: "Instagram handle" },
  tiktok: { label: "TikTok", placeholder: "@yourhandle", hint: "TikTok handle" },
  venmo: { label: "Venmo", placeholder: "@yourhandle", hint: "Venmo username" },
  cashapp: { label: "Cash App", placeholder: "$yourtag", hint: "Cash App $cashtag" },
  phone: { label: "Call", placeholder: "(415) 555-0134", hint: "Phone number" },
  sms: { label: "Text", placeholder: "(415) 555-0134", hint: "Phone number" },
  maps: { label: "Find the shop", placeholder: "123 Main St, Oakland CA", hint: "Shop address" },
  website: { label: "Website", placeholder: "yoursite.com", hint: "Any website" },
  custom: { label: "Link", placeholder: "example.com", hint: "Any link" },
};

// Handles across IG / TikTok / Venmo / Cash App all land inside this set.
const HANDLE_RE = /^[A-Za-z0-9._-]{1,30}$/;

export type NormalizedLink = { kind: LinkKind; label: string; url: string };
export type NormalizeResult =
  | { ok: true; link: NormalizedLink }
  | { ok: false; error: string };

function fail(error: string): NormalizeResult {
  return { ok: false, error };
}

/**
 * Is this href safe to render on a page we host?
 *
 * The threat here is a stored-XSS-shaped one: `javascript:` / `data:` /
 * `vbscript:` in an `href` executes when a visitor taps it. Note this is a
 * different question from src/lib/urlSafety.ts, which guards SSRF on URLs *we*
 * fetch — these URLs are only ever followed by the visitor's own browser, so
 * private-host blocking isn't the point. We still reject localhost links, since
 * a barber card pointing at 127.0.0.1 is always a mistake.
 */
export function isSafeLinkUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1") {
    return false;
  }
  return true;
}

// Path segments that sit *before* the handle in a profile URL and aren't the
// handle themselves — venmo.com/u/marcus, cash.app/pay/marcus.
const HANDLE_PATH_PREFIXES = new Set(["u", "pay"]);

/** Strip the leading sigil and any profile-URL wrapper a barber pasted instead of a handle. */
function toHandle(raw: string, hosts: string[]): string | null {
  let value = raw.trim();

  // They pasted the whole profile URL — pull the handle back out of it. `includes`
  // (not `startsWith`) so "www.instagram.com/…" pasted without a protocol still
  // reads as a URL instead of falling through and failing the handle regex.
  if (/^https?:\/\//i.test(value) || hosts.some((h) => value.toLowerCase().includes(h))) {
    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      const hostname = url.hostname.toLowerCase();
      // Match the host itself or any subdomain of it (www., m., web., …) —
      // `startsWith` alone rejected real links like m.instagram.com.
      if (!hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`))) {
        return null;
      }
      const segments = url.pathname.split("/").filter(Boolean);
      // Skip past /u/ and friends, then take the handle.
      const handleIndex = segments.findIndex((s) => !HANDLE_PATH_PREFIXES.has(s.toLowerCase()));
      value = handleIndex === -1 ? "" : segments[handleIndex];
    } catch {
      return null;
    }
  }

  value = value.replace(/^[@$]/, "").trim();
  return HANDLE_RE.test(value) ? value : null;
}

/** Digits (and a leading +) only — what `tel:` / `sms:` actually want. */
function toPhone(raw: string): string | null {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return plus ? `+${digits}` : digits;
}

function toWebUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Bare domains are the common case ("booksy.com/marcus") — assume https.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return isSafeLinkUrl(candidate) ? candidate : null;
}

/**
 * Turn one row of the builder form into a stored link. `customLabel` only
 * applies to `custom` — every other kind names itself.
 */
export function normalizeBarberLink(
  kind: string,
  raw: string,
  customLabel?: string,
): NormalizeResult {
  if (!isLinkKind(kind)) return fail("Unknown link type.");

  const value = raw.trim();
  if (!value) return fail("Add a value or remove this link.");

  const meta = LINK_META[kind];
  const label = (kind === "custom" ? customLabel?.trim() || meta.label : meta.label).slice(
    0,
    MAX_LABEL_LENGTH,
  );
  const done = (url: string): NormalizeResult => ({ ok: true, link: { kind, label, url } });

  switch (kind) {
    case "instagram": {
      const handle = toHandle(value, ["instagram.com"]);
      return handle
        ? done(`https://instagram.com/${handle}`)
        : fail("That doesn't look like an Instagram handle.");
    }
    case "tiktok": {
      const handle = toHandle(value, ["tiktok.com"]);
      return handle
        ? done(`https://tiktok.com/@${handle}`)
        : fail("That doesn't look like a TikTok handle.");
    }
    case "venmo": {
      const handle = toHandle(value, ["venmo.com"]);
      return handle
        ? done(`https://venmo.com/u/${handle}`)
        : fail("That doesn't look like a Venmo username.");
    }
    case "cashapp": {
      const handle = toHandle(value, ["cash.app"]);
      return handle
        ? done(`https://cash.app/$${handle}`)
        : fail("That doesn't look like a Cash App $cashtag.");
    }
    case "phone":
    case "sms": {
      const phone = toPhone(value);
      if (!phone) return fail("That doesn't look like a phone number.");
      return done(`${kind === "phone" ? "tel" : "sms"}:${phone}`);
    }
    case "maps": {
      // Already a maps/any URL? Keep it. Otherwise treat it as an address.
      const asUrl = /^https?:\/\//i.test(value) ? toWebUrl(value) : null;
      if (asUrl) return done(asUrl);
      return done(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`);
    }
    case "booking":
    case "website":
    case "custom": {
      const url = toWebUrl(value);
      return url ? done(url) : fail("That doesn't look like a valid link.");
    }
  }
}

// ── slugs ──
// Reserved so a barber can never claim a path that shadows a real route (or
// impersonates us) — /b/admin, /b/shapeup, etc.
const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "barber",
  "dashboard",
  "shapeup",
  "studio",
  "support",
  "settings",
  "pricing",
  "contact",
  "new",
  "edit",
  "null",
  "undefined",
]);

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

export type SlugCheck = { ok: true; slug: string } | { ok: false; error: string };

export function normalizeSlug(raw: string): SlugCheck {
  const slug = raw.trim().toLowerCase();
  if (slug.length < 3) return { ok: false, error: "At least 3 characters." };
  if (slug.length > 30) return { ok: false, error: "At most 30 characters." };
  if (!SLUG_RE.test(slug)) {
    return { ok: false, error: "Letters, numbers and dashes only — and it can't start or end with a dash." };
  }
  if (RESERVED_SLUGS.has(slug)) return { ok: false, error: "That name is reserved." };
  return { ok: true, slug };
}

/** Suggest a starting slug from whatever the barber called themselves. */
export function suggestSlug(displayName: string): string {
  const base = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");
  return base.length >= 3 ? base : "";
}
