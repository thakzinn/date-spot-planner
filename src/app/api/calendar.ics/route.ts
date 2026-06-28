// GET /api/calendar.ics?token=<base64url(email)>
// Capability URL (no passphrase) — the token is the user's base64-encoded email.
// We decode it and only serve a feed if it's an active registered user.
import { NextResponse } from "next/server";
import { getAllPlaces, isActiveUser } from "@/lib/sheets";
import { getAllPlans, getAllMilestones } from "@/lib/plansStore";
import { placeEventLines, buildMilestoneEvents, wrapCalendar } from "@/lib/ics";
import { isWithinWindow } from "@/lib/dates";
import { decodeFeedToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const reqUrl = new URL(req.url);
  const token = reqUrl.searchParams.get("token") ?? "";
  const email = decodeFeedToken(token);

  // 401 with NO redirect on a bad token or unknown/inactive user.
  if (!email || !(await isActiveUser(email))) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const all = await getAllPlaces();
  // Only this user's spots: ones they created OR ones they're invited to.
  const feed = all.filter(
    (p) =>
      (p.status === "planned" || p.status === "visited") &&
      isWithinWindow(p.planned_date) &&
      (p.created_by.trim().toLowerCase() === email || p.invitees.includes(email)),
  );

  // The user's plans (created or invited) -> a title lookup, then their
  // milestones/dated-checkpoints within the same date window.
  const plans = (await getAllPlans()).filter(
    (p) => p.created_by.trim().toLowerCase() === email || p.invitees.includes(email),
  );
  const planTitle = new Map(plans.map((p) => [p.id, p.title]));
  const milestoneLines = (await getAllMilestones())
    .filter((m) => planTitle.has(m.plan_id) && isWithinWindow(m.due_date))
    .flatMap((m) => buildMilestoneEvents(m, planTitle.get(m.plan_id) ?? ""));

  // Prefer APP_BASE_URL (stable behind a proxy) for the confirm-visit links;
  // fall back to the request origin. Matches lib/google-oauth callbackUrl.
  const confirmBaseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "") ?? reqUrl.origin;
  const body = wrapCalendar([
    ...placeEventLines(feed, { confirmBaseUrl }),
    ...milestoneLines,
  ]);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": 'inline; filename="date-spots.ics"',
    },
  });
}
