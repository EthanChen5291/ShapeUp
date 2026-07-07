// Resolves which reconstruction upstream to use per request.
//
// The secondary worker is a manually-powered GPU box (exposed via ngrok) that,
// when on, we prefer over the always-available primary worker (auto-scaling).
// The secondary worker is turned on by hand and stays up for a few hours, so we
// health-check it before each batch of work and fall back to the primary
// worker when it's down.
//
// Health probe: both servers register /process_image as POST-only, so a GET
// returns 405 when the server is actually running. A down/asleep ngrok tunnel
// returns 404 (ERR_NGROK_3200) or fails to connect — neither is a 405 — so a
// 405 is an unambiguous "secondary worker is up" signal that needs no
// server-side changes.

// The env var names below are fixed by what's actually configured in
// Vercel/local .env — bound to generic local names so the rest of this file
// (and its logs/types) doesn't spell out the vendor.
const PRIMARY_URL = process.env.FACELIFT_URL ?? '';
const SECONDARY_URL = process.env.OSCAR_FACELIFT_URL ?? '';
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
  return Boolean(PRIMARY_URL || SECONDARY_URL);
}

let cachedSecondaryUp: { up: boolean; at: number } | null = null;

async function isSecondaryUp(): Promise<boolean> {
  try {
    const res = await fetch(`${SECONDARY_URL}/process_image`, {
      method: 'GET',
      headers: getFaceliftHeaders(),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.status === 405; // route registered, POST-only → server is up
  } catch {
    return false; // connection refused / timeout / tunnel offline
  }
}

export type FaceliftUpstream = { name: 'secondary' | 'primary'; url: string };

// Returns the upstreams to attempt, in priority order, for a synchronous
// /process_image call. The caller tries them in turn and uses the first that
// returns a usable PLY — so the secondary worker is only *used* when it
// actually works, and the primary worker is the reliable fallback for any
// secondary-worker failure (down, wrong protocol, bad payload). The
// /process_image GET→405 probe only proves a route exists, not that it speaks
// our synchronous protocol, which is why the fallback (not the probe alone)
// is what guarantees reliability.
//
// FACELIFT_UPSTREAM forces behaviour:
//   "modal" → primary only      "oscar" → secondary first, primary fallback
//   "auto"/unset → secondary first only if the probe says it's up, else
//                  primary; primary is always appended as the fallback.
export async function resolveFaceliftUpstreams(): Promise<FaceliftUpstream[]> {
  const primary: FaceliftUpstream | null = PRIMARY_URL ? { name: 'primary', url: PRIMARY_URL } : null;
  const secondary: FaceliftUpstream | null = SECONDARY_URL ? { name: 'secondary', url: SECONDARY_URL } : null;
  const mode = (process.env.FACELIFT_UPSTREAM ?? 'auto').toLowerCase();

  const list: FaceliftUpstream[] = [];
  const push = (u: FaceliftUpstream | null) => {
    if (u && !list.some(x => x.url === u.url)) list.push(u);
  };

  if (mode === 'modal') {
    push(primary);
    push(secondary); // last resort if the primary worker isn't configured
  } else if (mode === 'oscar') {
    push(secondary);
    push(primary); // reliable fallback
  } else {
    if (secondary && (await isSecondaryUpCached())) push(secondary);
    push(primary);
    push(secondary); // if the primary worker is unconfigured, still try the secondary
  }

  const names = list.map(u => u.name).join(' → ') || 'none';
  console.log(`[facelift] upstream order: ${names}`);
  return list;
}

// isSecondaryUp() with the same brief TTL cache used for the legacy
// single-URL path, so repeated requests in auto mode don't each pay the probe
// latency.
async function isSecondaryUpCached(): Promise<boolean> {
  const now = Date.now();
  if (cachedSecondaryUp && now - cachedSecondaryUp.at < HEALTH_TTL_MS) return cachedSecondaryUp.up;
  const up = await isSecondaryUp();
  cachedSecondaryUp = { up, at: now };
  return up;
}
