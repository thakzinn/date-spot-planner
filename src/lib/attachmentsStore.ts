// Google Sheets CRUD for the `attachments` tab. Server-only. Built on
// ./sheetsCore and mirrors the read-then-write / soft-delete / ambiguous-id
// guard patterns of ./plansStore.
import { ensureTab, getSheetsClient, spreadsheetId } from "./sheetsCore";
import {
  ATTACHMENTS_TAB,
  ATTACHMENT_COLUMNS,
  FIRST_DATA_ROW,
  attachmentToRow,
  lastColumn,
  rowToAttachment,
  type Attachment,
  type AttachmentEntity,
} from "./attachments";

const LAST = lastColumn(ATTACHMENT_COLUMNS);

export class AttachmentNotFoundError extends Error {
  constructor(id: string) {
    super(`No attachment with id "${id}"`);
    this.name = "AttachmentNotFoundError";
  }
}

function client() {
  return getSheetsClient();
}

async function ensureTabs(): Promise<void> {
  await ensureTab(ATTACHMENTS_TAB, [...ATTACHMENT_COLUMNS]);
}

async function findRowNumber(id: string): Promise<number> {
  const res = await client().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${ATTACHMENTS_TAB}!A${FIRST_DATA_ROW}:A`,
  });
  const ids = res.data.values ?? [];
  const matches: number[] = [];
  ids.forEach((r, i) => {
    if (String(r?.[0] ?? "") === id) matches.push(FIRST_DATA_ROW + i);
  });
  if (matches.length === 0) throw new AttachmentNotFoundError(id);
  if (matches.length > 1)
    throw new Error(`Ambiguous id "${id}" matches rows ${matches.join(", ")}`);
  return matches[0];
}

// All non-deleted attachments (one Sheets read). Callers filter in memory —
// used by the per-entity and plan-tree (batch) lookups to avoid one read per
// entity, which would otherwise blow the per-minute read quota on a busy page.
export async function getAllAttachments(): Promise<Attachment[]> {
  await ensureTabs();
  const res = await client().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${ATTACHMENTS_TAB}!A${FIRST_DATA_ROW}:${LAST}`,
  });
  return (res.data.values ?? [])
    .filter((r) => String(r?.[0] ?? "").trim() !== "")
    .map(rowToAttachment)
    .filter((a) => !a.deleted_at);
}

// Non-deleted attachments for one entity, newest first.
export async function getAttachmentsForEntity(
  entityType: AttachmentEntity,
  entityId: string,
): Promise<Attachment[]> {
  const all = await getAllAttachments();
  return all
    .filter((a) => a.entity_type === entityType && a.entity_id === entityId)
    .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
}

export async function getAttachmentById(id: string): Promise<Attachment | null> {
  const all = await getAllAttachments();
  return all.find((a) => a.id === id) ?? null;
}

export async function appendAttachment(a: Attachment): Promise<void> {
  await ensureTabs();
  await client().spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${ATTACHMENTS_TAB}!A:${LAST}`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [attachmentToRow(a)] },
  });
}

export async function updateAttachmentById(a: Attachment): Promise<void> {
  const rowNum = await findRowNumber(a.id);
  await client().spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${ATTACHMENTS_TAB}!A${rowNum}:${LAST}${rowNum}`,
    valueInputOption: "RAW",
    requestBody: { values: [attachmentToRow(a)] },
  });
}
