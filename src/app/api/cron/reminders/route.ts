// GET /api/cron/reminders
// Scheduled job (Vercel Cron): reminds each plan's members about milestones (and
// dated checkpoints) that are due today (Bangkok) or overdue and still pending,
// and each spot's members about spots whose planned date has arrived/passed and
// aren't visited/cancelled yet. Reminders go out by email (plans, "as" the
// creator via their Gmail grant) AND by browser push to every member who has
// enabled notifications. Guarded by CRON_SECRET — Vercel Cron sends
// "Authorization: Bearer <secret>". Best-effort throughout.
import { NextResponse } from "next/server";
import { getAllPlans, getAllMilestones } from "@/lib/plansStore";
import { getAllPlaces, getUserGmailToken } from "@/lib/sheets";
import { sendPlanNotice } from "@/lib/gmail";
import { sendPushToUser } from "@/lib/push";
import { bangkokDateStr, isWithinWindow } from "@/lib/dates";
import { formatBangkok } from "@/lib/format";
import type { Milestone, Plan } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c] as string,
  );
}

// "due today or overdue" = its Bangkok calendar date is <= today, still within
// the past-30-day window (so we don't nag about ancient items), and not done.
function isDue(dueDate: string, todayStr: string): boolean {
  if (!dueDate || Number.isNaN(Date.parse(dueDate))) return false;
  if (!isWithinWindow(dueDate)) return false;
  return bangkokDateStr(new Date(Date.parse(dueDate))) <= todayStr;
}

interface DueItem {
  label: string;
  due: string;
  overdue: boolean;
}

// Fan a single push out to many members (best-effort). sendPushToUser never
// throws and silently no-ops for anyone without an enabled subscription, so we
// just fire them concurrently and tally how many devices actually received it.
async function pushToMembers(
  recipients: string[],
  payload: { title: string; body: string; url: string; tag: string },
): Promise<number> {
  const results = await Promise.all(
    recipients.map((email) =>
      sendPushToUser(email, payload).catch(() => ({ sent: 0 })),
    ),
  );
  return results.reduce((n, r) => n + r.sent, 0);
}

function collectDue(m: Milestone, todayStr: string): DueItem[] {
  const items: DueItem[] = [];
  if (m.status !== "done" && isDue(m.due_date, todayStr)) {
    items.push({
      label: m.title,
      due: m.due_date,
      overdue: bangkokDateStr(new Date(Date.parse(m.due_date))) < todayStr,
    });
  }
  for (const c of m.checkpoints) {
    if (!c.done && c.due_date && isDue(c.due_date, todayStr)) {
      items.push({
        label: `${m.title} — ${c.title}`,
        due: c.due_date,
        overdue: bangkokDateStr(new Date(Date.parse(c.due_date))) < todayStr,
      });
    }
  }
  return items;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.replace(/^Bearer\s+/i, "") || req.headers.get("x-cron-secret") || "";
  if (provided !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const todayStr = bangkokDateStr();
  const plans = (await getAllPlans()).filter((p) => p.status === "active");
  const byPlan = new Map<string, Plan>(plans.map((p) => [p.id, p]));
  const milestones = await getAllMilestones();

  // Group due items per plan.
  const duePerPlan = new Map<string, DueItem[]>();
  for (const m of milestones) {
    if (!byPlan.has(m.plan_id)) continue;
    const due = collectDue(m, todayStr);
    if (due.length) duePerPlan.set(m.plan_id, [...(duePerPlan.get(m.plan_id) ?? []), ...due]);
  }

  const results: Array<{ plan: string; sent: string[]; failed: string[]; pushed?: number; error?: string }> = [];
  for (const [planId, items] of duePerPlan) {
    const plan = byPlan.get(planId)!;
    const creator = plan.created_by.trim().toLowerCase();
    const recipients = [creator, ...plan.invitees].filter(Boolean);
    if (!recipients.length) continue;

    const sorted = items.sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
    const rows = sorted
      .map(
        (it) =>
          `<li>${it.overdue ? "⚠️ " : "🔔 "}<b>${esc(it.label)}</b> — ${esc(formatBangkok(it.due))}${
            it.overdue ? " <span style=\"color:#dc2626\">(overdue)</span>" : ""
          }</li>`,
      )
      .join("");
    const subject = `⏰ ${plan.title}: ${items.length} due`;
    const html =
      `<div style="font-family:system-ui,Arial,sans-serif;font-size:14px;line-height:1.5">` +
      `<p>Reminders for <b>${esc(plan.title)}</b>:</p><ul>${rows}</ul></div>`;

    // Browser push, in parallel with the email. Summarize the first item and
    // roll the rest into a "+N more" so the notification body stays short.
    const anyOverdue = sorted.some((it) => it.overdue);
    const more = items.length - 1;
    const pushBody =
      `${anyOverdue ? "⚠️ " : ""}${sorted[0].label}` +
      (more > 0 ? ` และอีก ${more} รายการ` : "");
    const pushed = await pushToMembers(recipients, {
      title: `⏰ ${plan.title}`,
      body: pushBody,
      url: "/plans",
      tag: `plan-due-${planId}`,
    });

    try {
      const token = await getUserGmailToken(creator);
      const r = await sendPlanNotice({ email: creator, name: plan.title }, token, subject, html, recipients);
      results.push({ plan: planId, sent: r.sent, failed: r.failed, pushed, error: r.error });
    } catch (err) {
      results.push({ plan: planId, sent: [], failed: recipients, pushed, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ---- spots (places) --------------------------------------------------------
  // A spot is "due" when its planned date has arrived today (Bangkok) or passed,
  // it's still within the reminder window, and it hasn't been visited/cancelled.
  // Reminders are grouped per member so each person gets one push covering all
  // of their due spots, rather than one push per spot.
  const places = (await getAllPlaces()).filter(
    (p) => p.status === "planned" && isDue(p.planned_date, todayStr),
  );
  const spotsByMember = new Map<string, { name: string; due: string; overdue: boolean }[]>();
  for (const p of places) {
    const members = [p.created_by.trim().toLowerCase(), ...p.invitees].filter(Boolean);
    const item = {
      name: p.place_name,
      due: p.planned_date,
      overdue: bangkokDateStr(new Date(Date.parse(p.planned_date))) < todayStr,
    };
    for (const email of members) {
      spotsByMember.set(email, [...(spotsByMember.get(email) ?? []), item]);
    }
  }

  const spotResults: Array<{ email: string; spots: number; pushed: number }> = [];
  for (const [email, items] of spotsByMember) {
    const sorted = items.sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
    const anyOverdue = sorted.some((it) => it.overdue);
    const more = items.length - 1;
    const body =
      `${anyOverdue ? "⚠️ " : "📍 "}${sorted[0].name}` +
      (more > 0 ? ` และอีก ${more} สถานที่` : "");
    const pushed = await pushToMembers([email], {
      title: `📍 ${items.length} สถานที่ถึงกำหนด`,
      body,
      url: "/spots",
      tag: "spots-due",
    });
    spotResults.push({ email, spots: items.length, pushed });
  }

  return NextResponse.json({
    ok: true,
    plansNotified: results.length,
    results,
    spotsNotified: spotResults.length,
    spotResults,
  });
}
