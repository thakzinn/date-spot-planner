// GET  /api/attachments?entity_type=&entity_id=  -> list an entity's files
// POST /api/attachments  (multipart/form-data: entity_type, entity_id, file)
//   -> upload a file to the signed-in user's Google Drive and link it
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { nowBangkokISO } from "@/lib/dates";
import { getUserGmailToken } from "@/lib/sheets";
import { resolveEntityAccess } from "@/lib/entityAccess";
import { getMilestonesByPlan } from "@/lib/plansStore";
import { DriveBlockedError, DriveScopeError, uploadToDrive } from "@/lib/drive";
import {
  appendAttachment,
  getAllAttachments,
  getAttachmentsForEntity,
} from "@/lib/attachmentsStore";
import {
  MAX_UPLOAD_BYTES,
  isAttachmentEntity,
  toPublic,
  type Attachment,
} from "@/lib/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}
function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  const url = new URL(req.url);

  // Batch mode: ?plan_id=… returns the attachments for the plan AND all of its
  // milestones in a single response, so the timeline loads every panel with one
  // request (and ~3 Sheets reads) instead of one request per milestone — the
  // N+1 fan-out that otherwise exhausts the Sheets per-minute read quota.
  const planId = (url.searchParams.get("plan_id") ?? "").trim();
  if (planId) {
    try {
      const access = await resolveEntityAccess(session.email, "plan", planId);
      if (!access) return bad("not found", 404);
      if (!access.canSee) return bad("forbidden", 403);

      const milestoneIds = new Set((await getMilestonesByPlan(planId)).map((m) => m.id));
      const all = await getAllAttachments();
      const relevant = all.filter(
        (a) =>
          (a.entity_type === "plan" && a.entity_id === planId) ||
          (a.entity_type === "milestone" && milestoneIds.has(a.entity_id)),
      );
      return NextResponse.json({ ok: true, attachments: relevant.map(toPublic) });
    } catch (err) {
      return bad(err instanceof Error ? err.message : String(err), 500);
    }
  }

  const entityType = url.searchParams.get("entity_type");
  const entityId = (url.searchParams.get("entity_id") ?? "").trim();
  if (!isAttachmentEntity(entityType) || !entityId) return bad("entity_type and entity_id are required");

  try {
    const access = await resolveEntityAccess(session.email, entityType, entityId);
    if (!access) return bad("not found", 404);
    if (!access.canSee) return bad("forbidden", 403);

    const list = await getAttachmentsForEntity(entityType, entityId);
    return NextResponse.json({ ok: true, attachments: list.map(toPublic) });
  } catch (err) {
    return bad(err instanceof Error ? err.message : String(err), 500);
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad("expected multipart/form-data");
  }

  const entityType = form.get("entity_type");
  const entityId = String(form.get("entity_id") ?? "").trim();
  const file = form.get("file");
  if (!isAttachmentEntity(entityType) || !entityId) return bad("entity_type and entity_id are required");
  if (!(file instanceof File) || file.size === 0) return bad("a non-empty file is required");
  if (file.size > MAX_UPLOAD_BYTES) {
    return bad(`file is too large (max ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB)`, 413);
  }

  const email = session.email.trim().toLowerCase();
  try {
    const access = await resolveEntityAccess(email, entityType, entityId);
    if (!access) return bad("not found", 404);
    if (!access.canSee) return bad("forbidden", 403);

    const token = await getUserGmailToken(email);
    if (!token) return bad("no_drive_grant", 403);

    const bytes = Buffer.from(await file.arrayBuffer());
    const drive = await uploadToDrive(token, {
      name: file.name || "file",
      mimeType: file.type || "application/octet-stream",
      bytes,
    });

    const now = nowBangkokISO();
    const attachment: Attachment = {
      id: `at_${Date.now()}_${randomUUID().slice(0, 8)}`,
      entity_type: entityType,
      entity_id: entityId,
      drive_file_id: drive.id,
      name: drive.name,
      mime_type: drive.mimeType,
      size: drive.size,
      uploaded_by: email,
      created_at: now,
      updated_at: now,
      deleted_at: "",
    };
    await appendAttachment(attachment);
    return NextResponse.json({ ok: true, attachment: toPublic(attachment) }, { status: 201 });
  } catch (err) {
    if (err instanceof DriveBlockedError) return bad("drive_blocked", 502);
    if (err instanceof DriveScopeError) return bad("no_drive_grant", 403);
    return bad(err instanceof Error ? err.message : String(err), 500);
  }
}
