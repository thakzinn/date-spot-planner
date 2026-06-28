// POST /api/places/:id/confirm   body { token }
// Token-authorized "confirm visit" — the capability link embedded in today's
// calendar events. Unlike PUT /api/places/:id (which needs a session cookie),
// this authorizes with the per-user feed token so it works when opened straight
// from a calendar app. Marks the place visited; idempotent if already visited.
import { NextResponse } from "next/server";
import { getPlaceById, updatePlaceById, isActiveUser, PlaceNotFoundError } from "@/lib/sheets";
import { decodeFeedToken } from "@/lib/auth";
import { nowBangkokISO } from "@/lib/dates";
import type { Place } from "@/lib/places";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const token = typeof body?.token === "string" ? body.token : "";
  const email = decodeFeedToken(token);

  if (!email || !(await isActiveUser(email))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const existing = await getPlaceById(id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  // Only the creator or an invitee of this spot may confirm it.
  const authorized =
    existing.created_by.trim().toLowerCase() === email || existing.invitees.includes(email);
  if (!authorized) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // Idempotent: a second confirm just echoes the already-visited place.
  if (existing.status === "visited") {
    return NextResponse.json({ ok: true, place: existing });
  }

  const now = nowBangkokISO();
  const updated: Place = {
    ...existing,
    status: "visited",
    visited_at: now,
    updated_at: now,
    updated_by: email,
  };

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
