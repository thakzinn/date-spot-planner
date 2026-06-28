// Google Sheets client for the `places` tab.
// Uses a service account (JWT) + @googleapis/sheets. Server-only — never import
// this into a client component.

import { sheets, type sheets_v4 } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import { nowBangkokISO } from "./dates";
import {
  FIRST_DATA_ROW,
  SHEET_TAB,
  placeToRow,
  rowToPlace,
  type Place,
} from "./places";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

// Thrown when an operation targets an id that isn't in the sheet.
export class PlaceNotFoundError extends Error {
  constructor(id: string) {
    super(`No place with id "${id}"`);
    this.name = "PlaceNotFoundError";
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

let cached: sheets_v4.Sheets | null = null;

function client(): sheets_v4.Sheets {
  if (cached) return cached;
  const client_email = requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  // Private keys are stored single-line with literal "\n"; restore real newlines.
  const private_key = requireEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  const auth = new GoogleAuth({
    credentials: { client_email, private_key },
    scopes: SCOPES,
  });
  cached = sheets({ version: "v4", auth });
  return cached;
}

function spreadsheetId(): string {
  return requireEnv("GOOGLE_SHEET_ID");
}

// Row 1 — used by the /api/health connectivity probe.
export async function getHeaderRow(): Promise<string[]> {
  const res = await client().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${SHEET_TAB}!A1:L1`,
  });
  return (res.data.values?.[0] ?? []).map((c) => String(c ?? ""));
}

// All data rows mapped to Place objects. Returns [] when only the header exists
// (Sheets omits `values` entirely in that case).
export async function getAllPlaces(): Promise<Place[]> {
  const res = await client().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${SHEET_TAB}!A${FIRST_DATA_ROW}:L`,
  });
  const rows = res.data.values ?? [];
  return rows.filter((r) => String(r?.[0] ?? "").trim() !== "").map(rowToPlace);
}

// Append a new place as the next data row.
export async function appendPlace(place: Place): Promise<void> {
  await client().spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${SHEET_TAB}!A:L`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [placeToRow(place)] },
  });
}

// Resolve the 1-based sheet row for an id by reading column A, immediately
// before writing. Read-then-write is non-atomic; acceptable for two users.
async function findRowNumber(id: string): Promise<number> {
  const res = await client().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${SHEET_TAB}!A${FIRST_DATA_ROW}:A`,
  });
  const ids = res.data.values ?? [];
  const idx = ids.findIndex((r) => String(r?.[0] ?? "") === id);
  if (idx === -1) throw new PlaceNotFoundError(id);
  return FIRST_DATA_ROW + idx;
}

// Overwrite the full row (A:L) for an existing place. Throws PlaceNotFoundError
// if the id is gone.
export async function updatePlaceById(place: Place): Promise<void> {
  const rowNum = await findRowNumber(place.id);
  await client().spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${SHEET_TAB}!A${rowNum}:L${rowNum}`,
    valueInputOption: "RAW",
    requestBody: { values: [placeToRow(place)] },
  });
}

// Fetch a single place by id, or null if absent.
export async function getPlaceById(id: string): Promise<Place | null> {
  const all = await getAllPlaces();
  return all.find((p) => p.id === id) ?? null;
}

// ---- users registry (tab `users`) --------------------------------------
// Columns: A=email | B=name | C=active | D=created_at. This is a self-service
// registry, NOT a credential store — no passwords or tokens live here. New
// Google sign-ins are appended automatically and allowed in (the real gate is
// Google's Test-users list while the OAuth app stays in "Testing"). Set a
// person's `active` cell to FALSE to block them without deleting the row.
const USERS_TAB = "users";
const USERS_HEADER = ["email", "name", "active", "created_at"];

function isActive(cell: unknown): boolean {
  const s = String(cell ?? "").trim().toLowerCase();
  // Blank/missing `active` defaults to allowed; only explicit falsy values block.
  return !["false", "no", "0", "inactive", "disabled"].includes(s);
}

// Create the `users` tab (with a header row) if it doesn't exist yet.
async function ensureUsersTab(): Promise<void> {
  const meta = await client().spreadsheets.get({ spreadsheetId: spreadsheetId() });
  const exists = (meta.data.sheets ?? []).some((s) => s.properties?.title === USERS_TAB);
  if (exists) return;
  await client().spreadsheets.batchUpdate({
    spreadsheetId: spreadsheetId(),
    requestBody: { requests: [{ addSheet: { properties: { title: USERS_TAB } } }] },
  });
  await client().spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${USERS_TAB}!A1:D1`,
    valueInputOption: "RAW",
    requestBody: { values: [USERS_HEADER] },
  });
}

// Outcome of a sign-in attempt against the registry.
//   active   -> may enter
//   disabled -> known but blocked (active set to a falsy value)
export type AuthzResult = "active" | "disabled";

// Register the user on first sign-in and report whether they may enter.
// - known + active   -> "active"
// - known + inactive -> "disabled" (you set active=FALSE to block them)
// - unknown          -> append with active=TRUE and let them in
export async function registerAndAuthorizeUser(
  email: string,
  name: string,
): Promise<AuthzResult> {
  const target = email.trim().toLowerCase();
  if (!target) return "disabled";
  await ensureUsersTab();

  const res = await client().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${USERS_TAB}!A2:C`,
  });
  const rows = (res.data.values ?? []).filter((r) => String(r?.[0] ?? "").trim() !== "");
  const existing = rows.find((r) => String(r?.[0] ?? "").trim().toLowerCase() === target);
  if (existing) return isActive(existing[2]) ? "active" : "disabled";

  // New sign-in: auto-register as active. Block later by setting active=FALSE.
  await client().spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${USERS_TAB}!A:D`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[target, name, "TRUE", nowBangkokISO()]] },
  });
  return "active";
}
