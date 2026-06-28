// GET  /api/places  -> list all places
// POST /api/places  -> add a new place
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { appendPlace, getAllPlaces } from "@/lib/sheets";
import { getSession } from "@/lib/auth";
import { nowBangkokISO } from "@/lib/dates";
import { parsePlaceInput, type Place } from "@/lib/places";
import { maybeInvite } from "@/lib/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  try {
    const all = await getAllPlaces();
    const email = session.email.trim().toLowerCase();
    // Only this user's spots: ones they created OR ones they're invited to.
    const places = all.filter(
      (p) => p.created_by.trim().toLowerCase() === email || p.invitees.includes(email),
    );
    return NextResponse.json({ ok: true, places });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  const body = await req.json().catch(() => null);
  const parsed = parsePlaceInput(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  // Control flag (not a place field): omit/true sends invites, false suppresses.
  const notify = (body as { notify?: unknown })?.notify !== false;

  const now = nowBangkokISO();
  const place: Place = {
    // Date.now() alone collides if two spots are created within the same
    // millisecond, and a colliding id makes a later edit overwrite the wrong
    // row. The random suffix keeps ids unique (and still time-sortable).
    id: `pl_${Date.now()}_${randomUUID().slice(0, 8)}`,
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
    created_by: session.email,
    updated_by: session.email,
    invitees: parsed.value.invitees,
    deleted_at: "",
  };

  try {
    await appendPlace(place);
    // Email every invitee unless the user opted out. Best-effort: a send failure
    // must not fail the save — the spot (and its invitee list) is already persisted.
    const invite = notify ? await maybeInvite(session, place, place.invitees) : null;
    return NextResponse.json({ ok: true, place, invite }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
