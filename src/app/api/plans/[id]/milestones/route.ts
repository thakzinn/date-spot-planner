// POST /api/plans/:id/milestones  -> add a milestone ("chapter") to the plan
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getPlanById, getMilestonesByPlan, appendMilestone } from "@/lib/plansStore";
import { getSession } from "@/lib/auth";
import { nowBangkokISO } from "@/lib/dates";
import { formatBangkok } from "@/lib/format";
import { exceedsPlanDue, parseMilestoneInput, type Milestone, type Plan } from "@/lib/plans";
import { stampCheckpoints } from "@/lib/milestoneOps";
import { diffAssignees, notifyAssignees } from "@/lib/assignNotice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canSee(plan: Plan, email: string): boolean {
  return plan.created_by.trim().toLowerCase() === email || plan.invitees.includes(email);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const email = session.email.trim().toLowerCase();

  const { id: planId } = await ctx.params;
  const plan = await getPlanById(planId);
  if (!plan) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (!canSee(plan, email)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = parseMilestoneInput(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  // A milestone (and its dated checkpoints) must not fall after the plan's due.
  if (plan.due_date) {
    const over =
      exceedsPlanDue(parsed.value.due_date, plan.due_date) ||
      parsed.value.checkpoints.some((c) => exceedsPlanDue(c.due_date, plan.due_date));
    if (over) {
      return NextResponse.json(
        { ok: false, error: `Dates must be on or before the plan due date (${formatBangkok(plan.due_date)}).` },
        { status: 400 },
      );
    }
  }

  const now = nowBangkokISO();
  // Default order_index to the current milestone count so new chapters append.
  const order_index =
    parsed.value.order_index ?? (await getMilestonesByPlan(planId)).length;

  const milestone: Milestone = {
    id: `ms_${Date.now()}_${randomUUID().slice(0, 8)}`,
    plan_id: planId,
    title: parsed.value.title,
    notes: parsed.value.notes,
    due_date: parsed.value.due_date,
    status: "pending",
    done_at: "",
    order_index,
    checkpoints: stampCheckpoints(parsed.value.checkpoints, now),
    created_at: now,
    updated_at: now,
    created_by: email,
    updated_by: email,
    deleted_at: "",
    assignees: parsed.value.assignees,
  };

  try {
    await appendMilestone(milestone);
    // Best-effort: email anyone assigned to this new milestone / its checkpoints.
    await notifyAssignees(session, plan, diffAssignees(null, milestone));
    return NextResponse.json({ ok: true, milestone }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
