// POST /api/places/:id/confirm   body { lat, lng }
// Session-authorized "check in" for the /visit/<id> page. Marks the spot
// visited, then emails everyone else on the plan (creator + invitees) that the
// signed-in user has arrived, sharing the posted live location as Google Maps +
// OpenStreetMap links. Idempotent: a second check-in re-sends the notice but
// won't double-stamp visited_at.
import { NextResponse } from "next/server";
import { getPlaceById, updatePlaceById, getUserGmailToken, PlaceNotFoundError } from "@/lib/sheets";
import { getSession } from "@/lib/auth";
import { nowBangkokISO } from "@/lib/dates";
import { sendArrivalNotice } from "@/lib/gmail";
import type { Place } from "@/lib/places";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : NaN;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const lat = num(body?.lat);
  const lng = num(body?.lng);
  const hasLocation =
    Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

  const existing = await getPlaceById(id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  // Only the creator or an invitee may check in.
  const email = session.email.trim().toLowerCase();
  const authorized =
    existing.created_by.trim().toLowerCase() === email || existing.invitees.includes(email);
  if (!authorized) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // Mark visited (skip re-stamping if it already is).
  let place: Place = existing;
  if (existing.status !== "visited") {
    const now = nowBangkokISO();
    place = { ...existing, status: "visited", visited_at: now, updated_at: now, updated_by: email };
    try {
      await updatePlaceById(place);
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

  // Notify everyone else on the plan (creator + invitees), minus the checker.
  // Best-effort: a mail failure must not fail the check-in.
  let notice: Awaited<ReturnType<typeof sendArrivalNotice>> | null = null;
  if (hasLocation) {
    const recipients = [existing.created_by.trim().toLowerCase(), ...existing.invitees].filter(
      (r) => r && r !== email,
    );
    if (recipients.length) {
      try {
        const token = await getUserGmailToken(session.email);
        notice = await sendArrivalNotice(session, token, place, recipients, { lat, lng });
      } catch (err) {
        notice = { sent: [], failed: [], error: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  return NextResponse.json({ ok: true, place, notice });
}
