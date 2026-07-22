// ============================================================
// Bio → structured card details.
//
// Linktree only structures a barber's name, bio, and links — never their
// location, hours, or service menu. Those, when they exist at all, are buried
// in the free-text bio ("Cuts on Telegraph Ave · Tue–Sat 9–6 · fades $40").
// This turns that prose into the same fields the builder edits, so the import
// button can fill them too.
//
// The model does the reading; this file is the *contract* around it — the
// prompt and the defensive parse of its JSON. Pure and unit-tested: no network
// lives here (the API route owns the fetch, auth, and rate limit). The parse is
// deliberately strict because the model's output is untrusted text that becomes
// a barber's public card, and this project never ships invented facts.
// ============================================================

// Mirror the builder's own field caps (see src/app/barber/page.tsx inputs) so
// anything we hand back is already save-ready.
const MAX_LOCATION = 80;
const MAX_HOURS = 120;
const MAX_SERVICE_NAME = 60;
const MAX_SERVICE_PRICE = 20;
const MAX_SERVICES = 12;

export interface ExtractedService {
  name: string;
  price?: string;
}

export interface BioDetails {
  location?: string;
  hours?: string;
  services: ExtractedService[];
}

export const EMPTY_BIO_DETAILS: BioDetails = { services: [] };

/** The system + user turns for the extraction call. */
export function buildBioExtractionMessages(bio: string): { system: string; user: string } {
  const system = [
    'You extract structured barbershop details from a bio a barber wrote for their link-in-bio page.',
    'Return ONLY a JSON object with exactly these keys:',
    '- "location": string — the shop\'s city, neighborhood, or street if stated (e.g. "Telegraph Ave, Oakland"). Empty string if not stated.',
    '- "hours": string — business hours in a short form (e.g. "Tue–Sat · 9–6"). Empty string if not stated.',
    '- "services": array of { "name": string, "price": string } — only services the bio explicitly names, with the price only if the bio gives one (keep the currency symbol; empty string if no price).',
    'CRITICAL: never invent, guess, or infer. Include a field only if it is explicitly present in the bio. When in doubt, leave it empty. An empty result is correct and expected.',
  ].join('\n');

  const user = `Bio:\n"""\n${bio}\n"""\n\nReturn the JSON now.`;
  return { system, user };
}

function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

/**
 * Parse the model's reply into card fields. Tolerant of markdown code fences and
 * junk; returns empty details rather than throwing on anything malformed.
 */
export function parseBioDetails(raw: string): BioDetails {
  if (typeof raw !== 'string') return { ...EMPTY_BIO_DETAILS };

  // Models often wrap JSON in ```json fences despite instructions — strip them,
  // then fall back to the first {...} span if there's still surrounding prose.
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!text.startsWith('{')) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return { ...EMPTY_BIO_DETAILS };
    text = text.slice(start, end + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...EMPTY_BIO_DETAILS };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ...EMPTY_BIO_DETAILS };
  const obj = parsed as Record<string, unknown>;

  const services: ExtractedService[] = [];
  if (Array.isArray(obj.services)) {
    for (const entry of obj.services) {
      if (services.length >= MAX_SERVICES) break;
      if (typeof entry !== 'object' || entry === null) continue;
      const svc = entry as Record<string, unknown>;
      const name = cleanString(svc.name, MAX_SERVICE_NAME);
      if (!name) continue; // A service with no name isn't a service.
      const price = cleanString(svc.price, MAX_SERVICE_PRICE);
      services.push(price ? { name, price } : { name });
    }
  }

  return {
    location: cleanString(obj.location, MAX_LOCATION),
    hours: cleanString(obj.hours, MAX_HOURS),
    services,
  };
}
