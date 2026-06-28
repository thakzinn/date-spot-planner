// GET /api/cron/reminders
// Scheduled job (Vercel Cron): emails each plan's members about milestones (and
// dated checkpoints) that are due today (Bangkok) or overdue and still pending.
// Guarded by CRON_SECRET — Vercel Cron sends "Authorization: Bearer <secret>".
// Sent "as" each plan's creator via their stored Gmail grant. Best-effort.
import { NextResponse } from "next/server";
import { getAllPlans, getAllMilestones } from "@/lib/plansStore";
import { getUserGmailToken } from "@/lib/sheets";
import { sendPlanNotice } from "@/lib/gmail";
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

  const results: Array<{ plan: string; sent: string[]; failed: string[]; error?: string }> = [];
  for (const [planId, items] of duePerPlan) {
    const plan = byPlan.get(planId)!;
    const creator = plan.created_by.trim().toLowerCase();
    const recipients = [creator, ...plan.invitees].filter(Boolean);
    if (!recipients.length) continue;

    const rows = items
      .sort((a, b) => Date.parse(a.due) - Date.parse(b.due))
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

    try {
      const token = await getUserGmailToken(creator);
      const r = await sendPlanNotice({ email: creator, name: plan.title }, token, subject, html, recipients);
      results.push({ plan: planId, sent: r.sent, failed: r.failed, error: r.error });
    } catch (err) {
      results.push({ plan: planId, sent: [], failed: recipients, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ ok: true, plansNotified: results.length, results });
}
