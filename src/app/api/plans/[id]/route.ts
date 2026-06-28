// GET    /api/plans/:id  -> the plan + its milestones (ordered)
// PUT    /api/plans/:id
//   body { action: "archive" | "complete" | "reopen" } -> status change
//   otherwise                                          -> edit fields (parsePlanInput)
// DELETE /api/plans/:id   -> soft-delete the plan AND all of its milestones
import { NextResponse } from "next/server";
import {
  getPlanById,
  getMilestonesByPlan,
  updatePlanById,
  updateMilestoneById,
  RecordNotFoundError,
} from "@/lib/plansStore";
import { getSession } from "@/lib/auth";
import { nowBangkokISO } from "@/lib/dates";
import { parsePlanInput, type Plan, type PlanStatus } from "@/lib/plans";

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

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { id } = await ctx.params;
  const plan = await getPlanById(id);
  if (!plan) return notFound();
  if (!canSee(plan, session.email.trim().toLowerCase())) return forbidden();

  try {
    const milestones = await getMilestonesByPlan(id);
    return NextResponse.json({ ok: true, plan, milestones });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  const email = session.email.trim().toLowerCase();

  const { id } = await ctx.params;
  const existing = await getPlanById(id);
  if (!existing) return notFound();
  if (!canSee(existing, email)) return forbidden();

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const action = typeof body?.action === "string" ? body.action : "";
  const now = nowBangkokISO();
  let updated: Plan;

  if (action === "archive" || action === "complete" || action === "reopen") {
    const status: PlanStatus =
      action === "archive" ? "archived" : action === "complete" ? "done" : "active";
    updated = { ...existing, status, updated_at: now, updated_by: email };
  } else {
    const parsed = parsePlanInput(body);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    const v = parsed.value;
    updated = {
      ...existing,
      title: v.title,
      description: v.description,
      status: v.status ?? existing.status,
      invitees: v.invitees,
      updated_at: now,
      updated_by: email,
    };
  }

  try {
    await updatePlanById(updated);
    return NextResponse.json({ ok: true, plan: updated });
  } catch (err) {
    if (err instanceof RecordNotFoundError) return notFound();
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  const email = session.email.trim().toLowerCase();

  const { id } = await ctx.params;
  const existing = await getPlanById(id);
  if (!existing) return notFound();
  if (!canSee(existing, email)) return forbidden();

  const now = nowBangkokISO();
  try {
    // Soft-delete the milestones first, then the plan, so a partial failure
    // never leaves orphan milestones visible without their plan.
    const milestones = await getMilestonesByPlan(id);
    for (const m of milestones) {
      await updateMilestoneById({ ...m, deleted_at: now, updated_at: now, updated_by: email });
    }
    await updatePlanById({ ...existing, deleted_at: now, updated_at: now, updated_by: email });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    if (err instanceof RecordNotFoundError) return notFound();
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
