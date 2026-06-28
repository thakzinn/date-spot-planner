// PUT    /api/places/:id
//   body { action: "visit" }   -> status=visited, visited_at=now
//   body { action: "unvisit" } -> status=planned, visited_at=""
//   otherwise                  -> edit fields (parsePlaceInput)
// DELETE /api/places/:id        -> soft delete (set deleted_at=now; row is kept)
import { NextResponse } from "next/server";
import { getPlaceById, updatePlaceById, PlaceNotFoundError } from "@/lib/sheets";
import { getSession } from "@/lib/auth";
import { nowBangkokISO } from "@/lib/dates";
import { parsePlaceInput, type Place } from "@/lib/places";
import { maybeInvite } from "@/lib/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id } = await ctx.params;
  const existing = await getPlaceById(id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const action = typeof body?.action === "string" ? body.action : "";
  // Control flag (not a place field): omit/true sends invites, false suppresses.
  const notify = body?.notify !== false;
  const now = nowBangkokISO();
  let updated: Place;
  // Only invitees ADDED in this edit get emailed — editing a spot mustn't
  // re-spam people who were already on the list. visit/unvisit add nobody.
  let newInvitees: string[] = [];

  if (action === "visit") {
    updated = { ...existing, status: "visited", visited_at: now, updated_at: now, updated_by: session.email };
  } else if (action === "unvisit") {
    updated = { ...existing, status: "planned", visited_at: "", updated_at: now, updated_by: session.email };
  } else {
    const parsed = parsePlaceInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }
    const v = parsed.value;
    newInvitees = v.invitees.filter((e) => !existing.invitees.includes(e));
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
      updated_by: session.email,
      invitees: v.invitees,
    };
  }

  try {
    await updatePlaceById(updated);
    const invite = notify ? await maybeInvite(session, updated, newInvitees) : null;
    return NextResponse.json({ ok: true, place: updated, invite });
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

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id } = await ctx.params;
  const existing = await getPlaceById(id);
  // Already-deleted rows are filtered out of getPlaceById, so a second delete
  // simply reports "not found" — the operation is idempotent from the client.
  if (!existing) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const now = nowBangkokISO();
  // Soft delete: stamp deleted_at and keep the row. getAllPlaces hides it.
  const updated: Place = { ...existing, deleted_at: now, updated_at: now, updated_by: session.email };

  try {
    await updatePlaceById(updated);
    return NextResponse.json({ ok: true, id });
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
