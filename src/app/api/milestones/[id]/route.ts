// PUT    /api/milestones/:id
//   body { action: "confirm" }  -> status=done, done_at=now ("check in"; early if before due_date)
//   body { action: "reopen" }   -> status=pending, done_at=""
//   body { action: "extend", due_date } -> push the due date out ("ขยายวัน")
//   body { action: "checkpoint", op, checkpoint } -> mutate one checklist item
//   otherwise                   -> edit fields (parseMilestoneInput)
//   Pass { notify: true } on confirm/extend to email the other plan members.
// DELETE /api/milestones/:id    -> soft-delete (set deleted_at=now; row kept)
import { NextResponse } from "next/server";
import {
  getMilestoneById,
  getPlanById,
  updateMilestoneById,
  RecordNotFoundError,
} from "@/lib/plansStore";
import { getUserGmailToken } from "@/lib/sheets";
import { getSession } from "@/lib/auth";
import { nowBangkokISO } from "@/lib/dates";
import { formatBangkok } from "@/lib/format";
import {
  exceedsPlanDue,
  normalizeInvitees,
  parseMilestoneInput,
  type Checkpoint,
  type Milestone,
  type Plan,
} from "@/lib/plans";
import { stampCheckpoints } from "@/lib/milestoneOps";
import { sendPlanNotice } from "@/lib/gmail";
import { diffAssignees, notifyAssignees } from "@/lib/assignNotice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}
function notFound() {
  return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
}
function forbidden() {
  return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
}

function canSee(plan: Plan, email: string): boolean {
  return plan.created_by.trim().toLowerCase() === email || plan.invitees.includes(email);
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

// Apply one checkpoint operation to the array, returning the new array.
function applyCheckpointOp(
  list: Checkpoint[],
  op: string,
  cp: Record<string, unknown>,
  now: string,
): Checkpoint[] {
  const id = str(cp.id).trim();
  if (op === "add") {
    const [stamped] = stampCheckpoints(
      [
        {
          id: "",
          title: str(cp.title),
          due_date: str(cp.due_date).trim(),
          done: cp.done === true,
          done_at: "",
          assignees: normalizeInvitees(cp.assignees),
        },
      ],
      now,
    );
    return stamped.title ? [...list, stamped] : list;
  }
  if (op === "remove") return list.filter((c) => c.id !== id);
  if (op === "toggle") {
    return list.map((c) =>
      c.id === id ? { ...c, done: !c.done, done_at: !c.done ? now : "" } : c,
    );
  }
  if (op === "edit") {
    return list.map((c) =>
      c.id === id
        ? {
            ...c,
            title: cp.title != null ? str(cp.title).trim() : c.title,
            due_date: cp.due_date != null ? str(cp.due_date).trim() : c.due_date,
            assignees: cp.assignees != null ? normalizeInvitees(cp.assignees) : c.assignees,
          }
        : c,
    );
  }
  return list;
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  const email = session.email.trim().toLowerCase();

  const { id } = await ctx.params;
  const existing = await getMilestoneById(id);
  if (!existing) return notFound();
  const plan = await getPlanById(existing.plan_id);
  if (!plan) return notFound();
  if (!canSee(plan, email)) return forbidden();

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const action = typeof body?.action === "string" ? body.action : "";
  const notify = body?.notify === true;
  const now = nowBangkokISO();
  let updated: Milestone;

  if (action === "confirm") {
    // Confirming a milestone closes out every checkpoint under it too, so it
    // can't be marked done while some of its own steps are still open.
    const checkpoints = existing.checkpoints.map((c) =>
      c.done ? c : { ...c, done: true, done_at: now },
    );
    updated = { ...existing, status: "done", done_at: now, checkpoints, updated_at: now, updated_by: email };
  } else if (action === "reopen") {
    updated = { ...existing, status: "pending", done_at: "", updated_at: now, updated_by: email };
  } else if (action === "extend") {
    const due = str(body.due_date).trim();
    if (!due || Number.isNaN(Date.parse(due)))
      return NextResponse.json({ ok: false, error: "due_date must be a valid date/time" }, { status: 400 });
    updated = { ...existing, due_date: due, updated_at: now, updated_by: email };
  } else if (action === "checkpoint") {
    const op = str(body.op).trim();
    const cp = (body.checkpoint ?? {}) as Record<string, unknown>;
    updated = {
      ...existing,
      checkpoints: applyCheckpointOp(existing.checkpoints, op, cp, now),
      updated_at: now,
      updated_by: email,
    };
  } else {
    const parsed = parseMilestoneInput(body);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    const v = parsed.value;
    updated = {
      ...existing,
      title: v.title,
      notes: v.notes,
      due_date: v.due_date,
      order_index: v.order_index ?? existing.order_index,
      checkpoints: stampCheckpoints(v.checkpoints, now),
      assignees: v.assignees,
      updated_at: now,
      updated_by: email,
    };
  }

  // Keep the invariant: no milestone/checkpoint date may fall after the plan due.
  // Covers edit (new dates), extend (new due) and checkpoint add/edit.
  if (plan.due_date) {
    const over =
      exceedsPlanDue(updated.due_date, plan.due_date) ||
      updated.checkpoints.some((c) => exceedsPlanDue(c.due_date, plan.due_date));
    if (over) {
      return NextResponse.json(
        { ok: false, error: `Dates must be on or before the plan due date (${formatBangkok(plan.due_date)}).` },
        { status: 400 },
      );
    }
  }

  try {
    await updateMilestoneById(updated);
  } catch (err) {
    if (err instanceof RecordNotFoundError) return notFound();
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  // Best-effort: email anyone *newly* assigned to this milestone or one of its
  // checkpoints by this edit (independent of the notify-on-confirm/extend flag).
  await notifyAssignees(session, plan, diffAssignees(existing, updated));

  // Best-effort event-driven email to the other plan members. Never fails the
  // mutation — the milestone is already saved.
  let notice: Awaited<ReturnType<typeof sendPlanNotice>> | null = null;
  if (notify && (action === "confirm" || action === "extend")) {
    const recipients = [plan.created_by.trim().toLowerCase(), ...plan.invitees].filter(
      (r) => r && r !== email,
    );
    if (recipients.length) {
      const verb =
        action === "confirm"
          ? `marked “${updated.title}” done`
          : `moved “${updated.title}” to ${formatBangkok(updated.due_date)}`;
      const subject = `📌 ${plan.title}: ${updated.title}`;
      const html =
        `<div style="font-family:system-ui,Arial,sans-serif;font-size:14px;line-height:1.5">` +
        `<p><b>${esc(session.name)}</b> ${esc(verb)} in <b>${esc(plan.title)}</b>.</p>` +
        `<p style="opacity:.7">Due: ${esc(formatBangkok(updated.due_date))} (Asia/Bangkok)</p></div>`;
      try {
        const token = await getUserGmailToken(session.email);
        notice = await sendPlanNotice(session, token, subject, html, recipients);
      } catch (err) {
        notice = { sent: [], failed: recipients, error: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  return NextResponse.json({ ok: true, milestone: updated, notice });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  const email = session.email.trim().toLowerCase();

  const { id } = await ctx.params;
  const existing = await getMilestoneById(id);
  if (!existing) return notFound();
  const plan = await getPlanById(existing.plan_id);
  if (!plan) return notFound();
  if (!canSee(plan, email)) return forbidden();

  const now = nowBangkokISO();
  try {
    await updateMilestoneById({ ...existing, deleted_at: now, updated_at: now, updated_by: email });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    if (err instanceof RecordNotFoundError) return notFound();
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// Escape user text before embedding in the notice HTML.
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
