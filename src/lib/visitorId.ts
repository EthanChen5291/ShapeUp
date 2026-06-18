// Stable per-device visitor id, used to bind the one-time free generation to a
// physical device (anti-Sybil). Best-effort: if FingerprintJS fails to load or
// run, we return "" and the server falls back to its account + IP gates.
//
// The id is sent raw to our own API route, which hashes it before storage — we
// never persist a raw fingerprint. Loaded lazily so it never blocks first paint
// and only pulls the dep when a generation is actually attempted.

let cached: Promise<string> | null = null;

export function getVisitorId(): Promise<string> {
  if (cached) return cached;
  cached = (async () => {
    try {
      const FingerprintJS = await import('@fingerprintjs/fingerprintjs');
      const agent = await FingerprintJS.load();
      const { visitorId } = await agent.get();
      return visitorId;
    } catch {
      return '';
    }
  })();
  return cached;
}
