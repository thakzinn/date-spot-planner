// Shared Google Sheets plumbing: a cached service-account (JWT) client, the
// spreadsheet id, and a generic tab bootstrap. Server-only — never import into a
// client component. Both the `places`/`users` store (lib/sheets) and the
// `plans`/`milestones` store (lib/plansStore) build on this.
import { sheets, type sheets_v4 } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

let cached: sheets_v4.Sheets | null = null;

// The shared, lazily-created Sheets v4 client.
export function getSheetsClient(): sheets_v4.Sheets {
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

export function spreadsheetId(): string {
  return requireEnv("GOOGLE_SHEET_ID");
}

// Tabs confirmed to exist in this (warm) process — once we've seen a tab we
// skip the spreadsheets.get probe on every later call. Tabs are never deleted
// at runtime, so this is safe and saves a Sheets *read* per store operation
// (which matters against the per-minute read quota when a page fans out many
// reads at once).
const ensuredTabs = new Set<string>();

// Create a tab (with a header row in A1) if it doesn't exist yet. Idempotent —
// safe to call before every read/write so new deployments self-bootstrap.
export async function ensureTab(title: string, header: string[]): Promise<void> {
  if (ensuredTabs.has(title)) return;
  const client = getSheetsClient();
  const meta = await client.spreadsheets.get({ spreadsheetId: spreadsheetId() });
  const exists = (meta.data.sheets ?? []).some((s) => s.properties?.title === title);
  if (exists) {
    ensuredTabs.add(title);
    return;
  }
  await client.spreadsheets.batchUpdate({
    spreadsheetId: spreadsheetId(),
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  const lastCol = String.fromCharCode("A".charCodeAt(0) + header.length - 1);
  await client.spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${title}!A1:${lastCol}1`,
    valueInputOption: "RAW",
    requestBody: { values: [header] },
  });
  ensuredTabs.add(title);
}
