// GET  /api/plans  -> the signed-in user's plans + all their milestones
// POST /api/plans  -> create a new plan
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { appendPlan, getAllPlans, getAllMilestones } from "@/lib/plansStore";
import { getSession, isAuthenticated } from "@/lib/auth";
import { nowBangkokISO } from "@/lib/dates";
import { parsePlanInput, type Plan } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

// A user sees a plan they created OR are invited to.
function canSee(plan: Plan, email: string): boolean {
  return plan.created_by.trim().toLowerCase() === email || plan.invitees.includes(email);
}

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!(await isAuthenticated())) return unauthorized();
  const email = session.email.trim().toLowerCase();
  try {
    const all = await getAllPlans();
    const plans = all.filter((p) => canSee(p, email));
    const planIds = new Set(plans.map((p) => p.id));
    const milestones = (await getAllMilestones()).filter((m) => planIds.has(m.plan_id));
    return NextResponse.json({ ok: true, plans, milestones });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  const body = await req.json().catch(() => null);
  const parsed = parsePlanInput(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  const now = nowBangkokISO();
  const plan: Plan = {
    id: `pn_${Date.now()}_${randomUUID().slice(0, 8)}`,
    title: parsed.value.title,
    description: parsed.value.description,
    status: parsed.value.status ?? "active",
    created_at: now,
    updated_at: now,
    created_by: session.email.trim().toLowerCase(),
    updated_by: session.email.trim().toLowerCase(),
    invitees: parsed.value.invitees,
    deleted_at: "",
  };

  try {
    await appendPlan(plan);
    return NextResponse.json({ ok: true, plan, milestones: [] }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
