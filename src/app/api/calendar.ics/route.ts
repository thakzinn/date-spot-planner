// GET /api/calendar.ics?token=<FEED_TOKEN>
// Public capability URL (no passphrase) — anyone with the token can read.
import { NextResponse } from "next/server";
import { getAllPlaces } from "@/lib/sheets";
import { buildCalendar } from "@/lib/ics";
import { isWithinWindow } from "@/lib/dates";
import { safeEqual } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const expected = process.env.FEED_TOKEN ?? "";

  // 401 with NO redirect on a bad/missing token.
  if (!expected || !safeEqual(token, expected)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const all = await getAllPlaces();
  const feed = all.filter(
    (p) =>
      (p.status === "planned" || p.status === "visited") &&
      isWithinWindow(p.planned_date),
  );

  const body = buildCalendar(feed);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": 'inline; filename="date-spots.ics"',
    },
  });
}
