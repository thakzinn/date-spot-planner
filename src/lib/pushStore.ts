// Web Push subscription store (tab `push_subscriptions`). One row per browser
// endpoint, tied to the signed-in user's email so we can push to a specific
// person across all the devices/browsers they've enabled. Built on the shared
// Sheets plumbing in ./sheetsCore. Server-only — never import into a client
// component.
//
// Columns: A=id | B=email | C=endpoint | D=p256dh | E=auth | F=user_agent
//          | G=created_at | H=updated_at
import { randomUUID } from "node:crypto";
import { nowBangkokISO } from "./dates";
import { ensureTab, getSheetsClient as client, spreadsheetId } from "./sheetsCore";

const TAB = "push_subscriptions";
const HEADER = [
  "id",
  "email",
  "endpoint",
  "p256dh",
  "auth",
  "user_agent",
  "created_at",
  "updated_at",
];
const LAST_COLUMN = "H";
const FIRST_DATA_ROW = 2;

// The shape web-push needs to send to an endpoint.
export interface PushSubscriptionRecord {
  id: string;
  email: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function rowToRecord(r: unknown[]): PushSubscriptionRecord {
  return {
    id: String(r[0] ?? ""),
    email: String(r[1] ?? "").trim().toLowerCase(),
    endpoint: String(r[2] ?? ""),
    keys: { p256dh: String(r[3] ?? ""), auth: String(r[4] ?? "") },
  };
}

async function ensure(): Promise<void> {
  await ensureTab(TAB, HEADER);
}

// All rows (raw values), or [] when only the header exists.
async function allRows(): Promise<unknown[][]> {
  const res = await client().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${TAB}!A${FIRST_DATA_ROW}:${LAST_COLUMN}`,
  });
  return (res.data.values ?? []).filter((r) => String(r?.[2] ?? "").trim() !== "");
}

// Resolve the 1-based row for an endpoint, or 0 if absent. Endpoints are unique
// per browser subscription, so this is our natural key.
async function findRowByEndpoint(endpoint: string): Promise<number> {
  const res = await client().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${TAB}!C${FIRST_DATA_ROW}:C`,
  });
  const rows = res.data.values ?? [];
  const i = rows.findIndex((r) => String(r?.[0] ?? "") === endpoint);
  return i === -1 ? 0 : i + FIRST_DATA_ROW;
}

// Upsert a subscription for a user. Re-subscribing the same browser (same
// endpoint) refreshes its keys + owner instead of creating a duplicate row.
export async function savePushSubscription(
  email: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent: string,
): Promise<void> {
  await ensure();
  const now = nowBangkokISO();
  const owner = email.trim().toLowerCase();
  const existing = await findRowByEndpoint(sub.endpoint);

  if (existing) {
    // Keep the original id (col A) and created_at (col G) untouched; refresh
    // owner + keys + UA (B:F) and updated_at (H) in two targeted writes.
    await client().spreadsheets.values.batchUpdate({
      spreadsheetId: spreadsheetId(),
      requestBody: {
        valueInputOption: "RAW",
        data: [
          {
            range: `${TAB}!B${existing}:F${existing}`,
            values: [[owner, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent]],
          },
          { range: `${TAB}!H${existing}`, values: [[now]] },
        ],
      },
    });
    return;
  }

  await client().spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${TAB}!A:${LAST_COLUMN}`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          `ps_${Date.now()}_${randomUUID().slice(0, 8)}`,
          owner,
          sub.endpoint,
          sub.keys.p256dh,
          sub.keys.auth,
          userAgent,
          now,
          now,
        ],
      ],
    },
  });
}

// Every subscription belonging to a user (across all their browsers).
export async function getSubscriptionsForUser(
  email: string,
): Promise<PushSubscriptionRecord[]> {
  await ensure();
  const target = email.trim().toLowerCase();
  const rows = await allRows();
  return rows.map(rowToRecord).filter((r) => r.email === target);
}

// Remove a subscription by endpoint. Used both on explicit unsubscribe and to
// prune dead endpoints the push service reports as 404/410 Gone. Idempotent.
export async function deleteSubscriptionByEndpoint(endpoint: string): Promise<void> {
  await ensure();
  const row = await findRowByEndpoint(endpoint);
  if (!row) return;
  // We can't delete a row via the values API without the sheetId; clearing the
  // row is enough — allRows()/find skip blank-endpoint rows. Keeps this store
  // dependency-free of a spreadsheets.get for the sheetId.
  await client().spreadsheets.values.clear({
    spreadsheetId: spreadsheetId(),
    range: `${TAB}!A${row}:${LAST_COLUMN}${row}`,
  });
}
