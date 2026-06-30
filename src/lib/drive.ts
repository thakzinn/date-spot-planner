// Google Drive helper for file attachments. Server-only — never import into a
// client component. Uploads use the UPLOADER's own OAuth token (drive.file
// scope), so bytes land in that user's Drive and count against their quota.
// This is deliberate: a service account has no Drive storage on a personal
// Gmail account, so it cannot hold the bytes. Files are kept PRIVATE (never
// shared) — the app streams them back to members through its own proxy route
// using the uploader's stored token. With drive.file the app can only ever
// touch files it created here, never the user's other Drive files.
import { randomUUID } from "node:crypto";
import { refreshTokenClient } from "./google-oauth";

// The tidy folder we drop every attachment into, inside the uploader's Drive.
const FOLDER_NAME = "Date Spot Planner";
const FOLDER_MIME = "application/vnd.google-apps.folder";

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

// Raised when the user's token lacks the drive.file grant (they signed in
// before attachments existed). The API layer maps this to a "re-login" notice
// rather than a generic 500.
export class DriveScopeError extends Error {
  constructor() {
    super("drive_not_granted");
    this.name = "DriveScopeError";
  }
}

// Raised when a corporate web proxy (e.g. McAfee Web Gateway on the KBANK
// network) intercepts the request and blocks Google Drive — a network/DLP
// policy, not anything the app can fix. The API layer maps this to a clear
// "blocked on this network" notice.
export class DriveBlockedError extends Error {
  constructor() {
    super("drive_blocked_by_proxy");
    this.name = "DriveBlockedError";
  }
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

// Mint a fresh access token from the stored refresh token. Throws if the token
// is missing/revoked.
async function accessTokenFor(refreshToken: string): Promise<string> {
  const { token } = await refreshTokenClient(refreshToken).getAccessToken();
  if (!token) throw new Error("Could not obtain a Google access token");
  return token;
}

// Turn a failed Drive fetch Response into the right error. Be PRECISE: only an
// actual scope/grant problem becomes DriveScopeError ("re-login"). Every other
// 4xx/5xx (most commonly "Drive API not enabled", but also quota, not-found,
// server errors) is surfaced verbatim — masking them all as "no grant" sends
// the user re-logging in forever to fix a problem that re-login can't touch.
async function driveError(res: Response, what: string): Promise<never> {
  const text = await res.text().catch(() => "");
  // A corporate web proxy (McAfee on the KBANK network, etc.) returns its own
  // HTML block page instead of a Google JSON error — Google Drive is commonly
  // DLP-blocked on such networks. Detect it so we don't dump HTML or mistake it
  // for a scope problem.
  if (/<!doctype html|<html|mcafee|web gateway|notification/i.test(text)) {
    throw new DriveBlockedError();
  }
  // Token is valid but lacks drive.file → re-consent is the fix.
  if (
    /ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient (authentication )?scopes?|insufficientpermissions|insufficient permission/i.test(
      text,
    )
  ) {
    throw new DriveScopeError();
  }
  // Bad/expired/revoked refresh token (re-login also helps here).
  if (res.status === 401 && /invalid_grant|invalid credentials|unauthorized/i.test(text)) {
    throw new DriveScopeError();
  }
  throw new Error(`Drive ${what} failed (${res.status}): ${text.slice(0, 500)}`);
}

// Find-or-create the app's folder in the uploader's Drive, cached per token for
// the life of the (warm) lambda to avoid a lookup on every upload. Under
// drive.file the list query only ever returns app-created files, so this finds
// the folder we made previously and nothing else.
const folderCache = new Map<string, string>();
async function ensureFolder(refreshToken: string, token: string): Promise<string> {
  const cached = folderCache.get(refreshToken);
  if (cached) return cached;

  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`,
  );
  const findRes = await fetch(`${DRIVE_API}?q=${q}&fields=files(id)&spaces=drive&pageSize=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!findRes.ok) await driveError(findRes, "folder lookup");
  const found = (await findRes.json()) as { files?: Array<{ id: string }> };
  const existing = found.files?.[0]?.id;
  if (existing) {
    folderCache.set(refreshToken, existing);
    return existing;
  }

  const createRes = await fetch(`${DRIVE_API}?fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
  });
  if (!createRes.ok) await driveError(createRes, "folder create");
  const created = (await createRes.json()) as { id: string };
  folderCache.set(refreshToken, created.id);
  return created.id;
}

// Upload `bytes` as a new file in the uploader's Drive (inside the app folder)
// via a single multipart/related request. Returns the created file's metadata.
export async function uploadToDrive(
  refreshToken: string,
  file: { name: string; mimeType: string; bytes: Buffer },
): Promise<DriveFile> {
  if (!refreshToken) throw new DriveScopeError();
  const token = await accessTokenFor(refreshToken);
  const folderId = await ensureFolder(refreshToken, token);

  const boundary = `dsp_${randomUUID().replace(/-/g, "")}`;
  const metadata = {
    name: file.name,
    parents: [folderId],
    mimeType: file.mimeType || "application/octet-stream",
  };
  const head =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${metadata.mimeType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = Buffer.concat([Buffer.from(head, "utf8"), file.bytes, Buffer.from(tail, "utf8")]);

  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,mimeType,size`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) await driveError(res, "upload");
  const created = (await res.json()) as { id: string; name: string; mimeType: string; size?: string };
  return {
    id: created.id,
    name: created.name,
    mimeType: created.mimeType,
    size: created.size ? parseInt(created.size, 10) || file.bytes.length : file.bytes.length,
  };
}

export interface DriveStream {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: string | null;
}

// Open a streaming read of a Drive file's bytes, authenticated as the uploader.
// Returns the web ReadableStream so the route handler can pipe it straight to
// the client without buffering the whole file in memory.
export async function streamDriveFile(
  refreshToken: string,
  fileId: string,
): Promise<DriveStream> {
  if (!refreshToken) throw new DriveScopeError();
  const token = await accessTokenFor(refreshToken);
  const res = await fetch(`${DRIVE_API}/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok || !res.body) await driveError(res, "download");
  return {
    stream: res.body as ReadableStream<Uint8Array>,
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
    contentLength: res.headers.get("content-length"),
  };
}

// Permanently delete a Drive file. Best-effort: a missing file (already gone)
// is treated as success so a delete stays idempotent.
export async function deleteDriveFile(refreshToken: string, fileId: string): Promise<void> {
  if (!refreshToken || !fileId) return;
  const token = await accessTokenFor(refreshToken);
  const res = await fetch(`${DRIVE_API}/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) await driveError(res, "delete");
}
