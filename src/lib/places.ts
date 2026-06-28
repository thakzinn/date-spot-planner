// Domain types + Google Sheet row <-> object mapping for the `places` tab.
// Columns A-P, in this exact order (see SETUP.md header row):
//   id | place_name | lat | lng | maps_url | planned_date | status |
//   visited_at | category | notes | created_at | updated_at | created_by |
//   updated_by | invitees | deleted_at

export type PlaceStatus = "planned" | "visited" | "cancelled";

export const PLACE_STATUSES: PlaceStatus[] = ["planned", "visited", "cancelled"];

export interface Place {
  id: string;
  place_name: string;
  lat: number;
  lng: number;
  maps_url: string;
  planned_date: string; // ISO 8601 with offset, e.g. 2026-07-05T18:00:00+07:00
  status: PlaceStatus;
  visited_at: string; // ISO 8601 or ""
  category: string;
  notes: string;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  created_by: string; // email of the user who created the spot, or ""
  updated_by: string; // email of the user who last updated the spot, or ""
  invitees: string[]; // lowercased emails invited to this spot (may be empty)
  deleted_at: string; // ISO 8601 when soft-deleted, or "" — non-empty rows are hidden everywhere
}

// The columns, in sheet order. Used to build A1 ranges & map rows.
export const PLACE_COLUMNS = [
  "id",
  "place_name",
  "lat",
  "lng",
  "maps_url",
  "planned_date",
  "status",
  "visited_at",
  "category",
  "notes",
  "created_at",
  "updated_at",
  "created_by",
  "updated_by",
  "invitees",
  "deleted_at",
] as const;

export const SHEET_TAB = "places";
export const FIRST_DATA_ROW = 2; // row 1 is the header

// Last sheet column letter, derived from PLACE_COLUMNS so A1 ranges stay in sync
// if the schema grows. 16 columns -> "P".
export const LAST_COLUMN = String.fromCharCode("A".charCodeAt(0) + PLACE_COLUMNS.length - 1);

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

// Loose RFC-5322-ish email check — enough to reject obvious junk, not a validator.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isEmail(s: string): boolean {
  return EMAIL_RE.test(s);
}

// Normalize a list of invitee emails: split a raw cell/array on commas, semicolons
// and whitespace, lowercase, drop invalid + duplicates, preserving first-seen order.
export function normalizeInvitees(input: unknown): string[] {
  const raw = Array.isArray(input) ? input.map((v) => str(v)) : str(input).split(/[,;\s]+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const email = item.trim().toLowerCase();
    if (!email || !isEmail(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : NaN;
}

function asStatus(v: unknown): PlaceStatus {
  const s = str(v).trim().toLowerCase();
  return s === "visited" || s === "cancelled" ? s : "planned";
}

// Map a raw sheet row (array of cells) to a Place. Missing trailing cells are
// tolerated (Sheets omits empty trailing cells).
export function rowToPlace(row: unknown[]): Place {
  return {
    id: str(row[0]),
    place_name: str(row[1]),
    lat: num(row[2]),
    lng: num(row[3]),
    maps_url: str(row[4]),
    planned_date: str(row[5]),
    status: asStatus(row[6]),
    visited_at: str(row[7]),
    category: str(row[8]),
    notes: str(row[9]),
    created_at: str(row[10]),
    updated_at: str(row[11]),
    created_by: str(row[12]),
    updated_by: str(row[13]),
    invitees: normalizeInvitees(row[14]),
    deleted_at: str(row[15]),
  };
}

// Fields a client may set on create/edit. Server owns id/timestamps/visited_at.
export interface PlaceInput {
  place_name: string;
  lat: number;
  lng: number;
  maps_url: string;
  planned_date: string;
  category: string;
  notes: string;
  status?: PlaceStatus;
  invitees: string[];
}

// Validate + normalize raw JSON from a request into PlaceInput, or return an
// error message. Does NOT guess coordinates.
export function parsePlaceInput(
  body: unknown,
): { ok: true; value: PlaceInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const place_name = str(b.place_name).trim();
  if (!place_name) return { ok: false, error: "place_name is required" };

  const lat = num(b.lat);
  const lng = num(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    return { ok: false, error: "lat and lng must be numbers" };
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180)
    return { ok: false, error: "lat/lng out of range" };

  const planned_date = str(b.planned_date).trim();
  if (!planned_date || Number.isNaN(Date.parse(planned_date)))
    return { ok: false, error: "planned_date must be a valid date/time" };

  const status =
    b.status === "visited" || b.status === "cancelled" || b.status === "planned"
      ? (b.status as PlaceStatus)
      : undefined;

  return {
    ok: true,
    value: {
      place_name,
      lat,
      lng,
      maps_url: str(b.maps_url).trim(),
      planned_date,
      category: str(b.category).trim(),
      notes: str(b.notes),
      status,
      invitees: normalizeInvitees(b.invitees),
    },
  };
}

// Map a Place back to a flat row of cells in column order.
export function placeToRow(p: Place): (string | number)[] {
  return [
    p.id,
    p.place_name,
    p.lat,
    p.lng,
    p.maps_url,
    p.planned_date,
    p.status,
    p.visited_at,
    p.category,
    p.notes,
    p.created_at,
    p.updated_at,
    p.created_by,
    p.updated_by,
    p.invitees.join(", "),
    p.deleted_at,
  ];
}
