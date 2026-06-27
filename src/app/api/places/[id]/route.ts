// PUT /api/places/:id
//   body { action: "visit" }   -> status=visited, visited_at=now
//   body { action: "unvisit" } -> status=planned, visited_at=""
//   otherwise                  -> edit fields (parsePlaceInput)
import { NextResponse } from "next/server";
import { getPlaceById, updatePlaceById, PlaceNotFoundError } from "@/lib/sheets";
import { isAuthenticated } from "@/lib/auth";
import { nowBangkokISO } from "@/lib/dates";
import { parsePlaceInput, type Place } from "@/lib/places";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return unauthorized();

  const { id } = await ctx.params;
  const existing = await getPlaceById(id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const action = typeof body?.action === "string" ? body.action : "";
  const now = nowBangkokISO();
  let updated: Place;

  if (action === "visit") {
    updated = { ...existing, status: "visited", visited_at: now, updated_at: now };
  } else if (action === "unvisit") {
    updated = { ...existing, status: "planned", visited_at: "", updated_at: now };
  } else {
    const parsed = parsePlaceInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }
    const v = parsed.value;
    updated = {
      ...existing,
      place_name: v.place_name,
      lat: v.lat,
      lng: v.lng,
      maps_url: v.maps_url,
      planned_date: v.planned_date,
      category: v.category,
      notes: v.notes,
      status: v.status ?? existing.status,
      updated_at: now,
    };
  }

  try {
    await updatePlaceById(updated);
    return NextResponse.json({ ok: true, place: updated });
  } catch (err) {
    if (err instanceof PlaceNotFoundError) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
