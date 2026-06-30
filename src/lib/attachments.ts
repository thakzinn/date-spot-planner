// Domain types + Google Sheet row <-> object mapping for the `attachments` tab.
// An attachment is a file the user uploaded to THEIR OWN Google Drive (via the
// drive.file scope) and linked to one entity — a spot, a plan, or a milestone.
// The bytes live in Drive (private, never shared); this sheet only stores the
// metadata + the Drive file id so the app can stream the file back through its
// own authenticated proxy. Mirrors the conventions of ./places and ./plans
// (trailing audit columns, soft-delete via deleted_at, lowercased emails).

// The three things a file can hang off of. Kept in sync with the entity stores.
export type AttachmentEntity = "spot" | "plan" | "milestone";
export const ATTACHMENT_ENTITIES: AttachmentEntity[] = ["spot", "plan", "milestone"];

export function isAttachmentEntity(v: unknown): v is AttachmentEntity {
  return v === "spot" || v === "plan" || v === "milestone";
}

// Columns A-K, in this exact order:
//   id | entity_type | entity_id | drive_file_id | name | mime_type | size |
//   uploaded_by | created_at | updated_at | deleted_at
export interface Attachment {
  id: string;
  entity_type: AttachmentEntity;
  entity_id: string;
  drive_file_id: string; // id of the file in the uploader's Google Drive
  name: string; // original filename
  mime_type: string;
  size: number; // bytes
  uploaded_by: string; // lowercased email — whose Drive holds the bytes
  created_at: string; // ISO 8601 +07:00
  updated_at: string;
  deleted_at: string; // ISO when soft-deleted, or ""
}

export const ATTACHMENT_COLUMNS = [
  "id",
  "entity_type",
  "entity_id",
  "drive_file_id",
  "name",
  "mime_type",
  "size",
  "uploaded_by",
  "created_at",
  "updated_at",
  "deleted_at",
] as const;

export const ATTACHMENTS_TAB = "attachments";
export const FIRST_DATA_ROW = 2; // row 1 is the header

export function lastColumn(columns: readonly string[]): string {
  return String.fromCharCode("A".charCodeAt(0) + columns.length - 1);
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function asEntity(v: unknown): AttachmentEntity {
  return isAttachmentEntity(v) ? v : "spot";
}

export function rowToAttachment(row: unknown[]): Attachment {
  return {
    id: str(row[0]),
    entity_type: asEntity(row[1]),
    entity_id: str(row[2]),
    drive_file_id: str(row[3]),
    name: str(row[4]),
    mime_type: str(row[5]),
    size: num(row[6]),
    uploaded_by: str(row[7]).trim().toLowerCase(),
    created_at: str(row[8]),
    updated_at: str(row[9]),
    deleted_at: str(row[10]),
  };
}

export function attachmentToRow(a: Attachment): (string | number)[] {
  return [
    a.id,
    a.entity_type,
    a.entity_id,
    a.drive_file_id,
    a.name,
    a.mime_type,
    a.size,
    a.uploaded_by,
    a.created_at,
    a.updated_at,
    a.deleted_at,
  ];
}

// What the client receives — never expose the raw Drive file id (the proxy
// addresses files by attachment id, so the Drive id stays server-side).
export interface AttachmentPublic {
  id: string;
  entity_type: AttachmentEntity;
  entity_id: string;
  name: string;
  mime_type: string;
  size: number;
  uploaded_by: string;
  created_at: string;
}

export function toPublic(a: Attachment): AttachmentPublic {
  return {
    id: a.id,
    entity_type: a.entity_type,
    entity_id: a.entity_id,
    name: a.name,
    mime_type: a.mime_type,
    size: a.size,
    uploaded_by: a.uploaded_by,
    created_at: a.created_at,
  };
}

// Max upload size. Kept under Vercel's ~4.5 MB serverless request-body limit so
// uploads don't fail at the platform edge before reaching our handler.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
