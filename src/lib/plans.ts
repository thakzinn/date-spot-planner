// Domain types + Google Sheet row <-> object mapping for the timeline feature:
// a `plans` tab (a goal/project) and a `milestones` tab (its dated "chapters",
// each carrying an inline JSON checklist of checkpoints). Mirrors the shape and
// conventions of ./places (trailing audit columns, soft-delete via deleted_at,
// ISO-8601 +07:00 timestamps, lowercased invitee emails).
import { isEmail, isGmail, normalizeInvitees } from "./places";

// ---- plans -----------------------------------------------------------------
// Columns A-K, in this exact order:
//   id | title | description | status | created_at | updated_at |
//   created_by | updated_by | invitees | deleted_at | due_date
// NOTE: due_date is appended LAST (after deleted_at) on purpose — it was added
// after launch, and appending keeps every existing row's column indices valid
// (old rows simply read due_date as "").
export type PlanStatus = "active" | "done" | "archived";
export const PLAN_STATUSES: PlanStatus[] = ["active", "done", "archived"];

export interface Plan {
  id: string;
  title: string;
  description: string;
  status: PlanStatus;
  created_at: string;
  updated_at: string;
  created_by: string; // email, or ""
  updated_by: string; // email, or ""
  invitees: string[]; // lowercased emails who share visibility / get reminders
  deleted_at: string; // ISO when soft-deleted, or ""
  due_date: string; // ISO 8601 +07:00 target finish for the whole plan, or ""
}

export const PLAN_COLUMNS = [
  "id",
  "title",
  "description",
  "status",
  "created_at",
  "updated_at",
  "created_by",
  "updated_by",
  "invitees",
  "deleted_at",
  "due_date",
] as const;

export const PLANS_TAB = "plans";

// ---- milestones ------------------------------------------------------------
// Columns A-N, in this exact order:
//   id | plan_id | title | notes | due_date | status | done_at |
//   order_index | checkpoints | created_at | updated_at | created_by |
//   updated_by | deleted_at
export type MilestoneStatus = "pending" | "done";
export const MILESTONE_STATUSES: MilestoneStatus[] = ["pending", "done"];

// A checklist item inside a milestone. `due_date` "" means "due with the
// milestone" (no own date). Stored as one JSON array in the checkpoints cell.
export interface Checkpoint {
  id: string;
  title: string;
  due_date: string; // ISO 8601 +07:00, or ""
  done: boolean;
  done_at: string; // ISO when ticked, or ""
  assignees: string[]; // lowercased emails responsible for this step (subset of plan members)
}

export interface Milestone {
  id: string;
  plan_id: string;
  title: string;
  notes: string;
  due_date: string; // ISO 8601 +07:00 — the target finish ("ปักวันเวลา")
  status: MilestoneStatus;
  done_at: string; // ISO when confirmed; if < due_date the UI shows "early"
  order_index: number;
  checkpoints: Checkpoint[];
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  deleted_at: string;
  assignees: string[]; // lowercased emails responsible for this milestone (subset of plan members)
}

// NOTE: `assignees` is appended LAST (after deleted_at) on purpose — like
// due_date on plans, it was added after launch, so appending keeps every
// existing row's column indices valid (old rows read assignees as "" -> []).
export const MILESTONE_COLUMNS = [
  "id",
  "plan_id",
  "title",
  "notes",
  "due_date",
  "status",
  "done_at",
  "order_index",
  "checkpoints",
  "created_at",
  "updated_at",
  "created_by",
  "updated_by",
  "deleted_at",
  "assignees",
] as const;

export const MILESTONES_TAB = "milestones";

export const FIRST_DATA_ROW = 2; // row 1 is the header in every tab

// Last column letter for a tab, derived from its column list so A1 ranges stay
// in sync if a schema grows.
export function lastColumn(columns: readonly string[]): string {
  return String.fromCharCode("A".charCodeAt(0) + columns.length - 1);
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function asPlanStatus(v: unknown): PlanStatus {
  const s = str(v).trim().toLowerCase();
  return s === "done" || s === "archived" ? s : "active";
}

function asMilestoneStatus(v: unknown): MilestoneStatus {
  return str(v).trim().toLowerCase() === "done" ? "done" : "pending";
}

// ---- plan row mapping ------------------------------------------------------
export function rowToPlan(row: unknown[]): Plan {
  return {
    id: str(row[0]),
    title: str(row[1]),
    description: str(row[2]),
    status: asPlanStatus(row[3]),
    created_at: str(row[4]),
    updated_at: str(row[5]),
    created_by: str(row[6]),
    updated_by: str(row[7]),
    invitees: normalizeInvitees(row[8]),
    deleted_at: str(row[9]),
    due_date: str(row[10]),
  };
}

export function planToRow(p: Plan): (string | number)[] {
  return [
    p.id,
    p.title,
    p.description,
    p.status,
    p.created_at,
    p.updated_at,
    p.created_by,
    p.updated_by,
    p.invitees.join(", "),
    p.deleted_at,
    p.due_date,
  ];
}

// ---- milestone row mapping -------------------------------------------------
// Parse the checkpoints cell defensively — a malformed/empty cell yields [].
export function parseCheckpoints(input: unknown): Checkpoint[] {
  if (Array.isArray(input)) return input.map(toCheckpoint).filter((c): c is Checkpoint => c !== null);
  const raw = str(input).trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(toCheckpoint).filter((c): c is Checkpoint => c !== null);
  } catch {
    return [];
  }
}

function toCheckpoint(v: unknown): Checkpoint | null {
  const o = (v ?? {}) as Record<string, unknown>;
  const title = str(o.title).trim();
  if (!title) return null;
  // Empty id is fine here: rows read from the sheet already carry ids, and new
  // checkpoints coming from the client get one stamped server-side on save.
  const id = str(o.id).trim();
  const due = str(o.due_date).trim();
  const done = o.done === true || str(o.done).toLowerCase() === "true";
  return {
    id,
    title,
    due_date: due && !Number.isNaN(Date.parse(due)) ? due : "",
    done,
    done_at: done ? str(o.done_at).trim() : "",
    assignees: normalizeInvitees(o.assignees),
  };
}

export function rowToMilestone(row: unknown[]): Milestone {
  return {
    id: str(row[0]),
    plan_id: str(row[1]),
    title: str(row[2]),
    notes: str(row[3]),
    due_date: str(row[4]),
    status: asMilestoneStatus(row[5]),
    done_at: str(row[6]),
    order_index: num(row[7]),
    checkpoints: parseCheckpoints(row[8]),
    created_at: str(row[9]),
    updated_at: str(row[10]),
    created_by: str(row[11]),
    updated_by: str(row[12]),
    deleted_at: str(row[13]),
    assignees: normalizeInvitees(row[14]),
  };
}

export function milestoneToRow(m: Milestone): (string | number)[] {
  return [
    m.id,
    m.plan_id,
    m.title,
    m.notes,
    m.due_date,
    m.status,
    m.done_at,
    m.order_index,
    JSON.stringify(m.checkpoints ?? []),
    m.created_at,
    m.updated_at,
    m.created_by,
    m.updated_by,
    m.deleted_at,
    m.assignees.join(", "),
  ];
}

// ---- input validation ------------------------------------------------------
// Client-settable fields for a plan. Server owns id/timestamps/audit columns.
export interface PlanInput {
  title: string;
  description: string;
  status?: PlanStatus;
  invitees: string[];
  due_date: string; // ISO 8601 +07:00, or "" (optional overall deadline)
}

export function parsePlanInput(
  body: unknown,
): { ok: true; value: PlanInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const title = str(b.title).trim();
  if (!title) return { ok: false, error: "title is required" };
  const status =
    b.status === "active" || b.status === "done" || b.status === "archived"
      ? (b.status as PlanStatus)
      : undefined;
  const due_date = str(b.due_date).trim();
  if (due_date && Number.isNaN(Date.parse(due_date)))
    return { ok: false, error: "due_date must be a valid date/time" };
  return {
    ok: true,
    value: {
      title,
      description: str(b.description),
      status,
      invitees: normalizeInvitees(b.invitees),
      due_date,
    },
  };
}

// True if a milestone/checkpoint date falls AFTER the plan's overall due date.
// No plan deadline (or unparseable input) ⇒ never exceeds.
export function exceedsPlanDue(dateISO: string, planDue: string): boolean {
  if (!planDue || !dateISO) return false;
  const a = Date.parse(dateISO);
  const b = Date.parse(planDue);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return a > b;
}

// Client-settable fields for a milestone. `checkpoints` accepts a loose array
// and is normalized; server stamps each checkpoint's id when missing.
export interface MilestoneInput {
  title: string;
  notes: string;
  due_date: string; // ISO 8601 +07:00
  checkpoints: Checkpoint[];
  order_index?: number;
  assignees: string[]; // lowercased emails responsible for this milestone
}

export function parseMilestoneInput(
  body: unknown,
): { ok: true; value: MilestoneInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const title = str(b.title).trim();
  if (!title) return { ok: false, error: "title is required" };

  const due_date = str(b.due_date).trim();
  if (!due_date || Number.isNaN(Date.parse(due_date)))
    return { ok: false, error: "due_date must be a valid date/time" };

  const order_index = b.order_index == null ? undefined : num(b.order_index);

  return {
    ok: true,
    value: {
      title,
      notes: str(b.notes),
      due_date,
      checkpoints: parseCheckpoints(b.checkpoints),
      order_index,
      assignees: normalizeInvitees(b.assignees),
    },
  };
}

// re-export so callers can validate/normalize emails without importing places too
export { isEmail, isGmail, normalizeInvitees };
