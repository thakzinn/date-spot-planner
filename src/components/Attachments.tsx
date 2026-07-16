"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Swal, showError, showSuccess } from "@/lib/swal";
import {
  MAX_UPLOAD_BYTES,
  type AttachmentEntity,
  type AttachmentPublic,
} from "@/lib/attachments";

const MAX_MB = Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024));

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Shorten a long filename in the MIDDLE, keeping the start and the tail (so the
// extension stays visible): "ข้อสอบ-…-580-ข้อ.pdf". Hover still shows the full
// name via title. Prevents very long names from widening the whole row/page.
function shortName(name: string, head = 16, tail = 12): string {
  if (name.length <= head + tail + 1) return name;
  return `${name.slice(0, head)}…${name.slice(-tail)}`;
}

// Friendly text for the API's machine-readable error codes.
function explain(error: string): string {
  if (error === "no_drive_grant")
    return "ยังไม่ได้ให้สิทธิ์ Google Drive — ออกจากระบบแล้วเข้าใหม่เพื่ออนุญาตให้แนบไฟล์ได้";
  if (error === "owner_no_drive_grant")
    return "บัญชีกลางที่เก็บไฟล์ยังไม่ได้ให้สิทธิ์ Google Drive — เจ้าของบัญชีกลางต้องเข้าสู่ระบบแล้วอนุญาต Drive ก่อน";
  if (error === "owner_not_configured")
    return "ยังไม่ได้ตั้งค่าบัญชีกลางสำหรับเก็บไฟล์ (ATTACHMENTS_OWNER_EMAIL)";
  if (error === "drive_blocked")
    return "เครือข่ายนี้บล็อก Google Drive (พร็อกซีองค์กร เช่น McAfee) — ลองใช้บนเว็บที่ deploy แล้ว หรือเครือข่ายที่ไม่ใช่ของบริษัท";
  if (error === "reauth_self")
    return "เซสชัน Google ของคุณหมดอายุ — กรุณาเข้าสู่ระบบใหม่";
  if (error === "reauth_owner")
    return "บัญชีกลางที่เก็บไฟล์หมดอายุการเชื่อมต่อ Google — ผู้ดูแลระบบต้องเข้าสู่ระบบใหม่ (การเข้าสู่ระบบใหม่ของคุณไม่ช่วยแก้)";
  if (error === "file_unavailable")
    return "เปิดไฟล์ไม่ได้ตอนนี้ (เจ้าของไฟล์อาจต้องเข้าสู่ระบบใหม่)";
  return error;
}

// A compact attachments panel for one entity (spot / plan / milestone). Lists
// files, previews images inline, and (when canEdit) lets members upload/delete.
// Files are streamed through /api/attachments/:id/content — they stay private
// in the uploader's Drive and are never publicly linked.
export default function Attachments({
  entityType,
  entityId,
  canEdit = true,
  className = "",
  initial,
}: {
  entityType: AttachmentEntity;
  entityId: string;
  canEdit?: boolean;
  className?: string;
  // When provided (even []), the parent has already loaded this entity's files
  // (e.g. the timeline's one batched fetch) — seed from it and skip the mount
  // fetch so the page doesn't fan out one request per panel. Omit to self-load.
  initial?: AttachmentPublic[];
}) {
  const [items, setItems] = useState<AttachmentPublic[]>(initial ?? []);
  const [loading, setLoading] = useState(initial === undefined);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/attachments?entity_type=${entityType}&entity_id=${encodeURIComponent(entityId)}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (data.ok) setItems(data.attachments as AttachmentPublic[]);
      else setError(explain(data.error ?? "โหลดข้อมูลไม่สำเร็จ"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    // Only self-fetch when the parent didn't hand us a preloaded list.
    if (initial === undefined) load();
  }, [load, initial]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) await upload(file);
    if (fileRef.current) fileRef.current.value = ""; // allow re-picking the same file
  }

  async function upload(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      showError(`ไฟล์ใหญ่เกินไป (สูงสุด ${MAX_MB} MB)`);
      return;
    }
    setUploading(true);
    setError("");
    try {
      const body = new FormData();
      body.set("entity_type", entityType);
      body.set("entity_id", entityId);
      body.set("file", file);
      const res = await fetch("/api/attachments", { method: "POST", body });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const msg = explain(data.error ?? "อัปโหลดไม่สำเร็จ");
        setError(msg);
        showError(msg);
        return;
      }
      setItems((prev) => [data.attachment as AttachmentPublic, ...prev]);
      showSuccess("แนบไฟล์แล้ว");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ";
      setError(msg);
      showError(msg);
    } finally {
      setUploading(false);
    }
  }

  // The signed-in user's OWN Google grant expired (reauth_self). Log them out
  // and bounce straight back into Google sign-in, returning to this page so the
  // freshly-minted token can open the file.
  const reauthSelf = useCallback(async () => {
    const c = await Swal.fire({
      title: "เซสชัน Google หมดอายุ",
      text: "การเชื่อมต่อ Google ของคุณหมดอายุ ต้องเข้าสู่ระบบใหม่เพื่อเปิดไฟล์",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "เข้าสู่ระบบใหม่",
      cancelButtonText: "ยกเลิก",
    });
    if (!c.isConfirmed) return;
    try {
      await fetch("/api/auth", { method: "DELETE" }); // clear the session cookie
    } catch {
      // ignore — sign-in below reissues the session regardless
    }
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/api/auth/google/start?next=${next}`;
  }, []);

  // Open (preview) or download a file through the private proxy. We fetch the
  // bytes ourselves so we can intercept an expired-grant error and react —
  // native <a href> would just dump the raw JSON error into a new tab. Files are
  // capped at a few MB, so buffering into a blob is cheap.
  const openFile = useCallback(
    async (a: AttachmentPublic, download: boolean) => {
      const href = `/api/attachments/${a.id}/content${download ? "?download=1" : ""}`;
      // For inline preview, open the tab synchronously on the click gesture so
      // popup blockers don't kill it; we point it at the blob once bytes arrive.
      const tab = download ? null : window.open("about:blank", "_blank");
      try {
        const res = await fetch(href, { cache: "no-store" });
        if (!res.ok) {
          tab?.close();
          let code = String(res.status);
          try {
            code = (await res.json())?.error || code;
          } catch {
            // non-JSON body — keep the status code as the error key
          }
          if (code === "reauth_self") {
            await reauthSelf();
            return;
          }
          showError(explain(code));
          return;
        }
        const url = URL.createObjectURL(await res.blob());
        if (download) {
          const link = document.createElement("a");
          link.href = url;
          link.download = a.name;
          document.body.appendChild(link);
          link.click();
          link.remove();
        } else if (tab) {
          tab.location.href = url;
        }
        // Revoke after a delay so the tab/download has time to consume the blob.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch {
        tab?.close();
        showError(explain("file_unavailable"));
      }
    },
    [reauthSelf],
  );

  async function remove(a: AttachmentPublic) {
    const c = await Swal.fire({
      title: "ลบไฟล์นี้?",
      text: a.name,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "ลบ",
      cancelButtonText: "ยกเลิก",
      confirmButtonColor: "#dc2626",
    });
    if (!c.isConfirmed) return;
    try {
      const res = await fetch(`/api/attachments/${a.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showError(explain(data.error ?? "ลบไม่สำเร็จ"));
        return;
      }
      setItems((prev) => prev.filter((x) => x.id !== a.id));
      showSuccess("ลบไฟล์แล้ว");
    } catch (e) {
      showError(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    }
  }

  return (
    <div className={`text-sm ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="opacity-70">📎 ไฟล์แนบ{items.length > 0 ? ` (${items.length})` : ""}</span>
        {canEdit && (
          <>
            <input
              ref={fileRef}
              type="file"
              onChange={onPick}
              disabled={uploading}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="rounded-lg border border-black/15 px-2.5 py-1 text-xs disabled:opacity-50 dark:border-white/25"
            >
              {uploading ? "กำลังอัปโหลด…" : `+ แนบไฟล์ (≤ ${MAX_MB} MB)`}
            </button>
          </>
        )}
      </div>

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}

      {loading ? (
        <p className="mt-1 text-xs opacity-50">กำลังโหลด…</p>
      ) : items.length === 0 ? (
        <p className="mt-1 text-xs opacity-50">ยังไม่มีไฟล์แนบ</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((a) => {
            const href = `/api/attachments/${a.id}/content`;
            const isImage = a.mime_type.startsWith("image/");
            return (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-lg border border-black/10 p-1.5 dark:border-white/15"
              >
                <button
                  type="button"
                  onClick={() => openFile(a, false)}
                  className="shrink-0"
                  aria-label={`เปิด ${a.name}`}
                >
                  {isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={href}
                      alt={a.name}
                      className="h-10 w-10 rounded object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded bg-black/5 text-lg dark:bg-white/10">
                      📄
                    </span>
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => openFile(a, false)}
                    className="block w-full truncate text-left hover:underline"
                    title={a.name}
                  >
                    {shortName(a.name)}
                  </button>
                  <span className="text-xs opacity-50">
                    {formatSize(a.size)} · @{a.uploaded_by.split("@")[0]}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => openFile(a, true)}
                  className="shrink-0 rounded-lg border border-black/15 px-2 py-1 text-xs dark:border-white/25"
                  title="ดาวน์โหลด"
                  aria-label={`ดาวน์โหลด ${a.name}`}
                >
                  ⬇
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => remove(a)}
                    aria-label={`ลบ ${a.name}`}
                    className="shrink-0 rounded-lg border border-black/15 px-2 py-1 text-xs dark:border-white/25"
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
