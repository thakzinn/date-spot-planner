// Best-effort lat/lng extraction from a pasted Google Maps URL.
// Never guesses: returns null when it can't be sure, so the UI asks the user to
// paste coordinates instead.

export interface LatLng {
  lat: number;
  lng: number;
}

function valid(lat: number, lng: number): LatLng | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

// Pull coordinates out of a maps URL string (no network).
export function extractFromUrl(url: string): LatLng | null {
  if (!url) return null;

  // !3d<lat>!4d<lng>  (place pin — most precise)
  const m3d = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (m3d) {
    const r = valid(parseFloat(m3d[1]), parseFloat(m3d[2]));
    if (r) return r;
  }

  // @<lat>,<lng>,<zoom>  (map center)
  const at = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) {
    const r = valid(parseFloat(at[1]), parseFloat(at[2]));
    if (r) return r;
  }

  // Query params that hold "lat,lng": q, query, ll, center, destination
  try {
    const u = new URL(url);
    for (const key of ["q", "query", "ll", "center", "destination"]) {
      const v = u.searchParams.get(key);
      if (!v) continue;
      const pair = v.match(/^\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (pair) {
        const r = valid(parseFloat(pair[1]), parseFloat(pair[2]));
        if (r) return r;
      }
    }
  } catch {
    // not a parseable URL — fall through
  }

  return null;
}

// SSRF guard: only these hosts may be fetched to resolve a short link.
function isAllowedMapsHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "maps.app.goo.gl" || h === "goo.gl") return true;
  if (h === "google.com" || h.endsWith(".google.com")) return true;
  // google country domains: google.co.th, www.google.co.jp, maps.google.de, ...
  return /^([a-z0-9-]+\.)*google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h);
}

// Resolve coordinates, following a Google short link if needed. Server-only.
export async function resolveLatLng(input: string): Promise<LatLng | null> {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return null;

  const direct = extractFromUrl(trimmed);
  if (direct) return direct;

  let host: string;
  try {
    host = new URL(trimmed).host;
  } catch {
    return null;
  }
  if (!isAllowedMapsHost(host)) return null;

  // Follow the redirect to the canonical URL, then extract. Bounded so a hung
  // target can't burn the serverless function budget.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(trimmed, {
      redirect: "follow",
      signal: controller.signal,
    });
    return extractFromUrl(res.url);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
