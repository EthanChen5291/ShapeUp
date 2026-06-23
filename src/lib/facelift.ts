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

let cachedOscarUp: { up: boolean; at: number } | null = null;

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

export type FaceliftUpstream = { name: 'OSCAR' | 'Modal'; url: string };

// Returns the upstreams to attempt, in priority order, for a synchronous
// /process_image call. The caller tries them in turn and uses the first that
// returns a usable PLY — so OSCAR is only *used* when it actually works, and
// Modal is the reliable fallback for any OSCAR failure (down, wrong protocol,
// bad payload). The /process_image GET→405 probe only proves a route exists,
// not that it speaks our synchronous protocol, which is why the fallback (not
// the probe alone) is what guarantees reliability.
//
// FACELIFT_UPSTREAM forces behaviour:
//   "modal" → Modal only      "oscar" → OSCAR first, Modal fallback
//   "auto"/unset → OSCAR first only if the probe says it's up, else Modal;
//                  Modal is always appended as the fallback.
export async function resolveFaceliftUpstreams(): Promise<FaceliftUpstream[]> {
  const modal: FaceliftUpstream | null = FACELIFT_URL ? { name: 'Modal', url: FACELIFT_URL } : null;
  const oscar: FaceliftUpstream | null = OSCAR_FACELIFT_URL ? { name: 'OSCAR', url: OSCAR_FACELIFT_URL } : null;
  const mode = (process.env.FACELIFT_UPSTREAM ?? 'auto').toLowerCase();

  const list: FaceliftUpstream[] = [];
  const push = (u: FaceliftUpstream | null) => {
    if (u && !list.some(x => x.url === u.url)) list.push(u);
  };

  if (mode === 'modal') {
    push(modal);
    push(oscar); // last resort if Modal isn't configured
  } else if (mode === 'oscar') {
    push(oscar);
    push(modal); // reliable fallback
  } else {
    if (oscar && (await isOscarUpCached())) push(oscar);
    push(modal);
    push(oscar); // if Modal is unconfigured, still try OSCAR
  }

  const names = list.map(u => u.name).join(' → ') || 'none';
  console.log(`[facelift] upstream order: ${names}`);
  return list;
}

// isOscarUp() with the same brief TTL cache used for the legacy single-URL path,
// so repeated requests in auto mode don't each pay the probe latency.
async function isOscarUpCached(): Promise<boolean> {
  const now = Date.now();
  if (cachedOscarUp && now - cachedOscarUp.at < HEALTH_TTL_MS) return cachedOscarUp.up;
  const up = await isOscarUp();
  cachedOscarUp = { up, at: now };
  return up;
}
