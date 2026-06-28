// Great-circle distance helpers. Pure math, no platform deps — safe to import
// from either a client component or the server.

const EARTH_RADIUS_M = 6_371_000; // mean Earth radius in metres

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Haversine distance in metres between two lat/lng points.
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Human-friendly distance: "120 m" under 1 km, "1.4 km" above.
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

// Beyond this, the page asks for an extra confirmation before marking visited.
export const CONFIRM_DISTANCE_THRESHOLD_M = 500;
