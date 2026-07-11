// GET /api/attachments/:id/content[?download=1]
//   Stream an attachment's bytes to a signed-in member. The file stays PRIVATE
//   in the uploader's Drive — we proxy it here using the uploader's stored token
//   so no public Drive link is ever exposed. ?download=1 forces a save dialog;
//   otherwise the browser previews inline (images, PDFs, etc.).
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserGmailToken } from "@/lib/sheets";
import { resolveEntityAccess } from "@/lib/entityAccess";
import { DriveBlockedError, DriveScopeError, streamDriveFile } from "@/lib/drive";
import { getAttachmentById } from "@/lib/attachmentsStore";
import { storageOwnerOf } from "@/lib/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// RFC 5987 — encode a filename safely for the Content-Disposition header.
function contentDisposition(name: string, download: boolean): string {
  const kind = download ? "attachment" : "inline";
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const utf8 = encodeURIComponent(name);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const download = new URL(req.url).searchParams.get("download") === "1";

  // Whose Drive holds the bytes — captured here so the catch can tell "your own
  // Google grant expired" (you can fix it by re-login) from "the central storage
  // account's grant expired" (only that account's owner can fix it).
  let storageOwner = "";

  try {
    const attachment = await getAttachmentById(id);
    if (!attachment) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

    const access = await resolveEntityAccess(session.email, attachment.entity_type, attachment.entity_id);
    if (!access || !access.canSee) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    storageOwner = storageOwnerOf(attachment);
    const ownerToken = await getUserGmailToken(storageOwner);
    if (!ownerToken) return NextResponse.json({ ok: false, error: "file_unavailable" }, { status: 502 });

    const { stream, contentType, contentLength } = await streamDriveFile(
      ownerToken,
      attachment.drive_file_id,
    );

    const headers = new Headers({
      "Content-Type": attachment.mime_type || contentType,
      "Content-Disposition": contentDisposition(attachment.name, download),
      // Private to this signed-in user — never let a shared cache hold it.
      "Cache-Control": "private, max-age=0, no-store",
    });
    if (contentLength) headers.set("Content-Length", contentLength);
    return new Response(stream, { status: 200, headers });
  } catch (err) {
    if (err instanceof DriveBlockedError) {
      return NextResponse.json({ ok: false, error: "drive_blocked" }, { status: 502 });
    }
    if (err instanceof DriveScopeError) {
      // Token revoked/expired or missing the drive.file grant. If it's the
      // signed-in user's OWN token, they can fix it by signing in again
      // (reauth_self → the client auto-logs-out and re-runs Google sign-in).
      // Otherwise it's the central storage account — re-login by the viewer
      // won't help, so surface a distinct code.
      const self = !!storageOwner && storageOwner === session.email.trim().toLowerCase();
      return NextResponse.json(
        { ok: false, error: self ? "reauth_self" : "reauth_owner" },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
