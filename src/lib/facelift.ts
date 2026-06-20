// Resolves which FaceLift upstream to use per request.
//
// OSCAR is a manually-powered GPU box (exposed via ngrok as OSCAR_FACELIFT_URL)
// that, when on, we prefer over the always-available Modal deployment
// (FACELIFT_URL). OSCAR is turned on by hand and stays up for a few hours, so we
// health-check it before each batch of work and fall back to Modal when it's down.
//
// Health probe: both servers register /process_image as POST-only, so a GET
// returns 405 when the server is actually running. A down/asleep ngrok tunnel
// returns 404 (ERR_NGROK_3200) or fails to connect — neither is a 405 — so a
// 405 is an unambiguous "OSCAR is up" signal that needs no server-side changes.

const FACELIFT_URL = process.env.FACELIFT_URL ?? '';
const OSCAR_FACELIFT_URL = process.env.OSCAR_FACELIFT_URL ?? '';
const FACELIFT_SHARED_SECRET = process.env.FACELIFT_SHARED_SECRET ?? '';

const HEALTH_TTL_MS = 60_000; // cache the up/down decision to avoid probing on every request
const PROBE_TIMEOUT_MS = 4_000;

export function getFaceliftHeaders(): HeadersInit {
  return {
    'ngrok-skip-browser-warning': '1',
    'User-Agent': 'shapeup',
    ...(FACELIFT_SHARED_SECRET ? { 'X-ShapeUp-Facelift-Secret': FACELIFT_SHARED_SECRET } : {}),
  };
}

export function isFaceliftConfigured(): boolean {
  return Boolean(FACELIFT_URL || OSCAR_FACELIFT_URL);
}

let cached: { url: string; at: number } | null = null;

async function isOscarUp(): Promise<boolean> {
  try {
    const res = await fetch(`${OSCAR_FACELIFT_URL}/process_image`, {
      method: 'GET',
      headers: getFaceliftHeaders(),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.status === 405; // route registered, POST-only → server is up
  } catch {
    return false; // connection refused / timeout / tunnel offline
  }
}

// Returns the base URL to use for FaceLift work.
//
// FACELIFT_UPSTREAM forces a choice and skips the health probe entirely:
//   "oscar" → always OSCAR     "modal" → always Modal     "auto"/unset → probe
// In auto mode we prefer OSCAR when it's up and fall back to Modal otherwise.
// The auto decision is cached briefly so repeated requests don't each pay the
// probe latency. Toggle the override with `npm run facelift oscar|modal|auto`.
export async function resolveFaceliftUrl(): Promise<string> {
  const url = await pickFaceliftUrl();
  const name = url === OSCAR_FACELIFT_URL ? 'OSCAR' : 'Modal';
  console.log(`[facelift] using ${name} → ${url}`);
  return url;
}

async function pickFaceliftUrl(): Promise<string> {
  const mode = (process.env.FACELIFT_UPSTREAM ?? 'auto').toLowerCase();
  if (mode === 'oscar') return OSCAR_FACELIFT_URL || FACELIFT_URL;
  if (mode === 'modal') return FACELIFT_URL || OSCAR_FACELIFT_URL;

  if (!OSCAR_FACELIFT_URL) return FACELIFT_URL;
  if (!FACELIFT_URL) return OSCAR_FACELIFT_URL; // nothing to fall back to

  const now = Date.now();
  if (cached && now - cached.at < HEALTH_TTL_MS) return cached.url;

  const url = (await isOscarUp()) ? OSCAR_FACELIFT_URL : FACELIFT_URL;
  cached = { url, at: now };
  return url;
}
