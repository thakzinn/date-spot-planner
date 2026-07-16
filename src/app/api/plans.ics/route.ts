// GET /api/plans.ics?token=<base64url(email)>
// Capability URL (no passphrase) — same token scheme as /api/calendar.ics.
// A focused feed of the user's PLANS whose overall due_date is still in the
// future (upcoming deadlines only); past-due and undated plans are omitted.
// For each kept plan we emit its overall due-date event PLUS every milestone
// and dated checkpoint, so the feed carries the full timeline (not just the
// plan deadline).
import { NextResponse } from "next/server";
import { isActiveUser } from "@/lib/sheets";
import { getAllPlans, getAllMilestones } from "@/lib/plansStore";
import { getAllAttachments } from "@/lib/attachmentsStore";
import {
  buildPlanEvents,
  buildMilestoneEvents,
  wrapCalendar,
  type IcsAttachmentRef,
} from "@/lib/ics";
import { isFuture } from "@/lib/dates";
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

  // The user's plans (created or invited) whose due_date hasn't passed yet.
  const plans = (await getAllPlans()).filter(
    (p) =>
      (p.created_by.trim().toLowerCase() === email || p.invitees.includes(email)) &&
      isFuture(p.due_date),
  );
  const planTitle = new Map(plans.map((p) => [p.id, p.title]));

  // Every milestone (and dated checkpoint) belonging to a kept plan — the full
  // timeline, not filtered by date, so done/early items still show.
  const [allMilestones, allAttachments] = await Promise.all([getAllMilestones(), getAllAttachments()]);
  const milestones = allMilestones.filter((m) => planTitle.has(m.plan_id));
  const milestoneIds = new Set(milestones.map((m) => m.id));
  const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "") ?? reqUrl.origin;
  const attachmentRefsByPlan = new Map<string, IcsAttachmentRef[]>();
  const attachmentRefsByMilestone = new Map<string, IcsAttachmentRef[]>();
  for (const a of allAttachments) {
    const ref: IcsAttachmentRef = {
      name: a.name,
      mimeType: a.mime_type,
      url: `${baseUrl}/api/attachments/${encodeURIComponent(a.id)}/content?token=${encodeURIComponent(token)}`,
    };
    if (a.entity_type === "plan" && planTitle.has(a.entity_id)) {
      const list = attachmentRefsByPlan.get(a.entity_id) ?? [];
      list.push(ref);
      attachmentRefsByPlan.set(a.entity_id, list);
    } else if (a.entity_type === "milestone" && milestoneIds.has(a.entity_id)) {
      const list = attachmentRefsByMilestone.get(a.entity_id) ?? [];
      list.push(ref);
      attachmentRefsByMilestone.set(a.entity_id, list);
    }
  }
  const milestoneLines = milestones.flatMap((m) =>
    buildMilestoneEvents(m, planTitle.get(m.plan_id) ?? "", [
      ...(attachmentRefsByPlan.get(m.plan_id) ?? []),
      ...(attachmentRefsByMilestone.get(m.id) ?? []),
    ]),
  );
  const planLines = plans.flatMap((p) => buildPlanEvents(p, attachmentRefsByPlan.get(p.id) ?? []));

  const body = wrapCalendar(
    [...planLines, ...milestoneLines],
    { calName: "Upcoming Plans" },
  );
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": 'inline; filename="upcoming-plans.ics"',
    },
  });
}
