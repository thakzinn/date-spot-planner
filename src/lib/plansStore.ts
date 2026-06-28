// Google Sheets CRUD for the `plans` and `milestones` tabs. Server-only.
// Built on ./sheetsCore (shared client + tab bootstrap) and mirrors the
// read-then-write, soft-delete, ambiguous-id-guard patterns of ./sheets.
import { ensureTab, getSheetsClient, spreadsheetId } from "./sheetsCore";
import {
  FIRST_DATA_ROW,
  MILESTONES_TAB,
  MILESTONE_COLUMNS,
  PLANS_TAB,
  PLAN_COLUMNS,
  lastColumn,
  milestoneToRow,
  planToRow,
  rowToMilestone,
  rowToPlan,
  type Milestone,
  type Plan,
} from "./plans";

const PLANS_LAST = lastColumn(PLAN_COLUMNS);
const MILESTONES_LAST = lastColumn(MILESTONE_COLUMNS);

// Thrown when an operation targets an id that isn't in its tab.
export class RecordNotFoundError extends Error {
  constructor(id: string) {
    super(`No record with id "${id}"`);
    this.name = "RecordNotFoundError";
  }
}

function client() {
  return getSheetsClient();
}

// Ensure both tabs exist (with headers). Cheap and idempotent — called before
// every read so a fresh spreadsheet self-bootstraps on first use.
async function ensureTabs(): Promise<void> {
  await ensureTab(PLANS_TAB, [...PLAN_COLUMNS]);
  await ensureTab(MILESTONES_TAB, [...MILESTONE_COLUMNS]);
}

// Resolve the 1-based row for an id in a tab by scanning column A. Refuses to
// guess on a duplicate id (overwriting the wrong row is the data-loss bug).
async function findRowNumber(tab: string, id: string): Promise<number> {
  const res = await client().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${tab}!A${FIRST_DATA_ROW}:A`,
  });
  const ids = res.data.values ?? [];
  const matches: number[] = [];
  ids.forEach((r, i) => {
    if (String(r?.[0] ?? "") === id) matches.push(FIRST_DATA_ROW + i);
  });
  if (matches.length === 0) throw new RecordNotFoundError(id);
  if (matches.length > 1)
    throw new Error(`Ambiguous id "${id}" matches rows ${matches.join(", ")}`);
  return matches[0];
}

// ---- plans -----------------------------------------------------------------
export async function getAllPlans(): Promise<Plan[]> {
  await ensureTabs();
  const res = await client().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${PLANS_TAB}!A${FIRST_DATA_ROW}:${PLANS_LAST}`,
  });
  return (res.data.values ?? [])
    .filter((r) => String(r?.[0] ?? "").trim() !== "")
    .map(rowToPlan)
    .filter((p) => !p.deleted_at);
}

export async function getPlanById(id: string): Promise<Plan | null> {
  const all = await getAllPlans();
  return all.find((p) => p.id === id) ?? null;
}

export async function appendPlan(plan: Plan): Promise<void> {
  await ensureTabs();
  await client().spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${PLANS_TAB}!A:${PLANS_LAST}`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [planToRow(plan)] },
  });
}

export async function updatePlanById(plan: Plan): Promise<void> {
  const rowNum = await findRowNumber(PLANS_TAB, plan.id);
  await client().spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${PLANS_TAB}!A${rowNum}:${PLANS_LAST}${rowNum}`,
    valueInputOption: "RAW",
    requestBody: { values: [planToRow(plan)] },
  });
}

// ---- milestones ------------------------------------------------------------
export async function getAllMilestones(): Promise<Milestone[]> {
  await ensureTabs();
  const res = await client().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${MILESTONES_TAB}!A${FIRST_DATA_ROW}:${MILESTONES_LAST}`,
  });
  return (res.data.values ?? [])
    .filter((r) => String(r?.[0] ?? "").trim() !== "")
    .map(rowToMilestone)
    .filter((m) => !m.deleted_at);
}

// A plan's milestones, ordered by order_index then due_date.
export async function getMilestonesByPlan(planId: string): Promise<Milestone[]> {
  const all = await getAllMilestones();
  return all
    .filter((m) => m.plan_id === planId)
    .sort(
      (a, b) =>
        a.order_index - b.order_index ||
        (Date.parse(a.due_date) || 0) - (Date.parse(b.due_date) || 0),
    );
}

export async function getMilestoneById(id: string): Promise<Milestone | null> {
  const all = await getAllMilestones();
  return all.find((m) => m.id === id) ?? null;
}

export async function appendMilestone(m: Milestone): Promise<void> {
  await ensureTabs();
  await client().spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${MILESTONES_TAB}!A:${MILESTONES_LAST}`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [milestoneToRow(m)] },
  });
}

export async function updateMilestoneById(m: Milestone): Promise<void> {
  const rowNum = await findRowNumber(MILESTONES_TAB, m.id);
  await client().spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${MILESTONES_TAB}!A${rowNum}:${MILESTONES_LAST}${rowNum}`,
    valueInputOption: "RAW",
    requestBody: { values: [milestoneToRow(m)] },
  });
}
