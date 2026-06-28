// Google Sheets client for the `places` tab.
// Uses a service account (JWT) + @googleapis/sheets. Server-only — never import
// this into a client component. Shared Sheets plumbing lives in ./sheetsCore;
// `client` here is just an alias for that cached client so existing call sites
// (`client().spreadsheets…`) keep working unchanged.
import { nowBangkokISO } from "./dates";
import { ensureTab, getSheetsClient as client, spreadsheetId } from "./sheetsCore";
import {
  FIRST_DATA_ROW,
  LAST_COLUMN,
  SHEET_TAB,
  placeToRow,
  rowToPlace,
  type Place,
} from "./places";

// Thrown when an operation targets an id that isn't in the sheet.
export class PlaceNotFoundError extends Error {
  constructor(id: string) {
    super(`No place with id "${id}"`);
    this.name = "PlaceNotFoundError";
  }
}

// Row 1 — used by the /api/health connectivity probe.
export async function getHeaderRow(): Promise<string[]> {
  const res = await client().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${SHEET_TAB}!A1:${LAST_COLUMN}1`,
  });
  return (res.data.values?.[0] ?? []).map((c) => String(c ?? ""));
}

// All (non-deleted) data rows mapped to Place objects. Returns [] when only the
// header exists (Sheets omits `values` entirely in that case). Soft-deleted rows
// (non-empty `deleted_at`) are kept in the sheet but excluded here, so they
// disappear from the list, map, calendar feed, and getPlaceById.
export async function getAllPlaces(): Promise<Place[]> {
  const res = await client().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${SHEET_TAB}!A${FIRST_DATA_ROW}:${LAST_COLUMN}`,
  });
  const rows = res.data.values ?? [];
  return rows
    .filter((r) => String(r?.[0] ?? "").trim() !== "")
    .map(rowToPlace)
    .filter((p) => !p.deleted_at);
}

// Append a new place as the next data row.
export async function appendPlace(place: Place): Promise<void> {
  await client().spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${SHEET_TAB}!A:${LAST_COLUMN}`,
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
  const matches: number[] = [];
  ids.forEach((r, i) => {
    if (String(r?.[0] ?? "") === id) matches.push(FIRST_DATA_ROW + i);
  });
  if (matches.length === 0) throw new PlaceNotFoundError(id);
  // Refuse to guess when an id is duplicated — overwriting the first match
  // silently clobbers a different spot's row (the data-loss bug).
  if (matches.length > 1)
    throw new Error(`Ambiguous id "${id}" matches rows ${matches.join(", ")}`);
  return matches[0];
}

// Overwrite the full row (A:O) for an existing place. Throws PlaceNotFoundError
// if the id is gone.
export async function updatePlaceById(place: Place): Promise<void> {
  const rowNum = await findRowNumber(place.id);
  await client().spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${SHEET_TAB}!A${rowNum}:${LAST_COLUMN}${rowNum}`,
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
// Columns: A=email | B=name | C=active | D=created_at | E=gmail_refresh_token.
// A self-service registry that doubles as the store for each user's Gmail
// refresh token — the one credential we DO keep, so the app can send date
// invites "as" that user via the Gmail API (see lib/gmail.ts). New Google
// sign-ins are appended automatically and allowed in (the real gate is Google's
// Test-users list while the OAuth app stays in "Testing"). Set a person's
// `active` cell to FALSE to block them without deleting the row.
const USERS_TAB = "users";
const USERS_HEADER = ["email", "name", "active", "created_at", "gmail_refresh_token"];

function isActive(cell: unknown): boolean {
  const s = String(cell ?? "").trim().toLowerCase();
  // Blank/missing `active` defaults to allowed; only explicit falsy values block.
  return !["false", "no", "0", "inactive", "disabled"].includes(s);
}

// Create the `users` tab (with a header row) if it doesn't exist yet.
async function ensureUsersTab(): Promise<void> {
  await ensureTab(USERS_TAB, USERS_HEADER);
}

// Resolve the 1-based row number in the users tab for an email, or 0 if absent.
async function findUserRow(email: string): Promise<number> {
  const target = email.trim().toLowerCase();
  if (!target) return 0;
  const res = await client().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${USERS_TAB}!A2:A`,
  });
  const rows = res.data.values ?? [];
  const i = rows.findIndex((r) => String(r?.[0] ?? "").trim().toLowerCase() === target);
  return i === -1 ? 0 : i + 2; // +2: data starts at row 2
}

// Persist a user's Gmail refresh token (column E). No-op if the user row is gone.
// Google only returns a refresh token on the first offline consent, so callers
// must skip empty tokens rather than clobbering a previously stored one.
export async function setUserGmailToken(email: string, refreshToken: string): Promise<void> {
  if (!refreshToken) return;
  await ensureUsersTab();
  const row = await findUserRow(email);
  if (!row) return;
  await client().spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${USERS_TAB}!E${row}`,
    valueInputOption: "RAW",
    requestBody: { values: [[refreshToken]] },
  });
}

// Read a user's stored Gmail refresh token, or "" if none / user absent.
export async function getUserGmailToken(email: string): Promise<string> {
  const target = email.trim().toLowerCase();
  if (!target) return "";
  let rows: unknown[][];
  try {
    const res = await client().spreadsheets.values.get({
      spreadsheetId: spreadsheetId(),
      range: `${USERS_TAB}!A2:E`,
    });
    rows = res.data.values ?? [];
  } catch {
    return "";
  }
  const existing = rows.find((r) => String(r?.[0] ?? "").trim().toLowerCase() === target);
  return existing ? String(existing[4] ?? "").trim() : "";
}

// Outcome of a sign-in attempt against the registry.
//   active   -> may enter
//   disabled -> known but blocked (active set to a falsy value)
export type AuthzResult = "active" | "disabled";

// Read-only: is this email a known, active user? Used to authorize the per-user
// calendar feed token (base64-encoded email). Returns false if the users tab
// doesn't exist yet or the email isn't registered.
export async function isActiveUser(email: string): Promise<boolean> {
  const target = email.trim().toLowerCase();
  if (!target) return false;
  let rows: unknown[][];
  try {
    const res = await client().spreadsheets.values.get({
      spreadsheetId: spreadsheetId(),
      range: `${USERS_TAB}!A2:C`,
    });
    rows = res.data.values ?? [];
  } catch {
    return false; // users tab missing or unreadable -> deny
  }
  const existing = rows.find((r) => String(r?.[0] ?? "").trim().toLowerCase() === target);
  return existing ? isActive(existing[2]) : false;
}

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
