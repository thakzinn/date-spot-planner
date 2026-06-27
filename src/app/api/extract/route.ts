// POST /api/extract  body { url } -> { ok, lat, lng } | { ok:false }
// Best-effort coordinate extraction from a Google Maps URL. Never guesses.
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { resolveLatLng } from "@/lib/mapsUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const url = typeof body?.url === "string" ? body.url : "";

  const coords = await resolveLatLng(url);
  if (!coords) {
    return NextResponse.json({
      ok: false,
      error: "Couldn't read coordinates from that link. Please paste lat, lng manually.",
    });
  }
  return NextResponse.json({ ok: true, lat: coords.lat, lng: coords.lng });
}
