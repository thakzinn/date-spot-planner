// DELETE /api/attachments/:id
//   Remove an attachment: delete the file from the uploader's Drive and
//   soft-delete the metadata row. Allowed for the uploader or the entity owner.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { nowBangkokISO } from "@/lib/dates";
import { getUserGmailToken } from "@/lib/sheets";
import { resolveEntityAccess } from "@/lib/entityAccess";
import { deleteDriveFile } from "@/lib/drive";
import {
  AttachmentNotFoundError,
  getAttachmentById,
  updateAttachmentById,
} from "@/lib/attachmentsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const email = session.email.trim().toLowerCase();

  try {
    const attachment = await getAttachmentById(id);
    // Soft-deleted rows are filtered out, so a repeat delete is idempotent.
    if (!attachment) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

    const access = await resolveEntityAccess(email, attachment.entity_type, attachment.entity_id);
    if (!access || !access.canSee) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
    const mayDelete = attachment.uploaded_by === email || access.ownerEmail.trim().toLowerCase() === email;
    if (!mayDelete) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    // Remove the bytes from the uploader's Drive first (best-effort), then drop
    // the row. Use the UPLOADER's token — only their Drive holds the file.
    try {
      const ownerToken = await getUserGmailToken(attachment.uploaded_by);
      if (ownerToken) await deleteDriveFile(ownerToken, attachment.drive_file_id);
    } catch {
      /* Drive cleanup failed — still soft-delete the row so it leaves the UI */
    }

    const now = nowBangkokISO();
    await updateAttachmentById({ ...attachment, deleted_at: now, updated_at: now });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    if (err instanceof AttachmentNotFoundError) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
