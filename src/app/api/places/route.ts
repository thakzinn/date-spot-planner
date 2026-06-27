// GET  /api/places  -> list all places
// POST /api/places  -> add a new place
import { NextResponse } from "next/server";
import { appendPlace, getAllPlaces } from "@/lib/sheets";
import { isAuthenticated } from "@/lib/auth";
import { nowBangkokISO } from "@/lib/dates";
import { parsePlaceInput, type Place } from "@/lib/places";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export async function GET() {
  if (!(await isAuthenticated())) return unauthorized();
  try {
    const places = await getAllPlaces();
    return NextResponse.json({ ok: true, places });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!(await isAuthenticated())) return unauthorized();

  const body = await req.json().catch(() => null);
  const parsed = parsePlaceInput(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  const now = nowBangkokISO();
  const place: Place = {
    id: `pl_${Date.now()}`,
    place_name: parsed.value.place_name,
    lat: parsed.value.lat,
    lng: parsed.value.lng,
    maps_url: parsed.value.maps_url,
    planned_date: parsed.value.planned_date,
    status: parsed.value.status ?? "planned",
    visited_at: "",
    category: parsed.value.category,
    notes: parsed.value.notes,
    created_at: now,
    updated_at: now,
  };

  try {
    await appendPlace(place);
    return NextResponse.json({ ok: true, place }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
