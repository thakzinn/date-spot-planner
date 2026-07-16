"use client";

import { useEffect, useState } from "react";
import { isEmail, isGmail, type Place, type PlaceStatus } from "@/lib/places";
import { isoToLocalInput, localInputToISO } from "@/lib/format";
import { showLoading, showSuccess, showError } from "@/lib/swal";
import DateTimePicker from "./DateTimePicker";
import Attachments from "./Attachments";

export interface SpotPayload {
  place_name: string;
  planned_date: string; // ISO with offset
  lat: number;
  lng: number;
  maps_url: string;
  category: string;
  notes: string;
  status: PlaceStatus;
  invitees: string[];
  notify: boolean; // whether to email the pending recipients on save
}

export default function SpotForm({
  initial,
  busy,
  onSave,
  onCancel,
  onPreview,
}: {
  initial: Place | null;
  busy: boolean;
  onSave: (payload: SpotPayload, id: string | null) => void;
  onCancel: () => void;
  onPreview?: (coords: [number, number] | null) => void;
}) {
  const [placeName, setPlaceName] = useState(initial?.place_name ?? "");
  const [localDate, setLocalDate] = useState(
    initial ? isoToLocalInput(initial.planned_date) : "",
  );
  const [lat, setLat] = useState(initial ? String(initial.lat) : "");
  const [lng, setLng] = useState(initial ? String(initial.lng) : "");
  const [mapsUrl, setMapsUrl] = useState(initial?.maps_url ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [status, setStatus] = useState<PlaceStatus>(initial?.status ?? "planned");
  const [invitees, setInvitees] = useState<string[]>(initial?.invitees ?? []);
  const [inviteeDraft, setInviteeDraft] = useState("");
  const [inviteeError, setInviteeError] = useState("");
  // The chip currently being edited in place (its original value), or null.
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [notify, setNotify] = useState(true);

  // Who would actually be emailed on save: only invitees NOT already on the spot
  // (editing mustn't re-spam existing guests — mirrors the server's diff logic).
  // For a new spot, initial is null so this is the full list.
  const initialInvitees = initial?.invitees ?? [];
  const pendingRecipients = invitees.filter((e) => !initialInvitees.includes(e));

  const [extracting, setExtracting] = useState(false);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");

  // Live-preview the typed/extracted coordinates on the map; clear it on unmount.
  useEffect(() => {
    if (!onPreview) return;
    const latN = parseFloat(lat);
    const lngN = parseFloat(lng);
    onPreview(Number.isFinite(latN) && Number.isFinite(lngN) ? [latN, lngN] : null);
    return () => onPreview(null);
  }, [lat, lng, onPreview]);

  async function onExtract() {
    if (!mapsUrl.trim()) return;
    setExtracting(true);
    setHint("");
      showLoading("กำลังดึงพิกัด…");
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: mapsUrl.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setLat(String(data.lat));
        setLng(String(data.lng));
        // Extract reflects the link, so overwrite the name with what we found.
        if (data.name) setPlaceName(data.name);
        setHint(
          data.name
              ? `พบ ${data.name} — ${data.lat}, ${data.lng}`
              : `พบพิกัด ${data.lat}, ${data.lng}`,
        );
          showSuccess(data.name ? `พบ ${data.name}` : "ดึงพิกัดสำเร็จ");
      } else {
          const msg = data.error ?? "ดึงพิกัดไม่สำเร็จ — กรอก lat, lng เอง";
        setHint(msg);
        showError(msg);
      }
    } catch {
        setHint("ดึงพิกัดไม่สำเร็จ — กรอก lat, lng เอง");
        showError("ดึงพิกัดไม่สำเร็จ — กรอก lat, lng เอง");
    } finally {
      setExtracting(false);
    }
  }

  // Commit the draft as a chip. Returns the resulting list so submit() can flush
  // a half-typed email without waiting for a state update.
  function addInvitee(raw: string): string[] {
    const email = raw.trim().toLowerCase().replace(/[,;]+$/, "");
    if (!email) return invitees;
    if (!isEmail(email)) {
        setInviteeError(`"${email}" ไม่ใช่อีเมลที่ถูกต้อง`);
      return invitees;
    }
    if (!isGmail(email)) {
        setInviteeError(`"${email}" ต้องเป็นอีเมล @gmail.com — การเข้าสู่ระบบใช้ Google`);
      return invitees;
    }
    setInviteeError("");
    if (invitees.includes(email)) {
      setInviteeDraft("");
      return invitees;
    }
    const next = [...invitees, email];
    setInvitees(next);
    setInviteeDraft("");
    return next;
  }

  function onInviteeKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Enter/comma/semicolon commit a chip; Backspace on an empty box removes the last.
    if (e.key === "Enter" || e.key === "," || e.key === ";") {
      e.preventDefault();
      addInvitee(inviteeDraft);
    } else if (e.key === "Backspace" && !inviteeDraft && invitees.length) {
      setInvitees(invitees.slice(0, -1));
    }
  }

  function removeInvitee(email: string) {
    setInvitees(invitees.filter((e) => e !== email));
  }

  function startEditInvitee(email: string) {
    setEditingEmail(email);
    setEditDraft(email);
    setInviteeError("");
  }

  function cancelEditInvitee() {
    setEditingEmail(null);
    setEditDraft("");
  }

  // Commit an in-place chip edit, replacing the original email at its position.
  function commitEditInvitee() {
    if (editingEmail === null) return;
    const email = editDraft.trim().toLowerCase().replace(/[,;]+$/, "");
    if (email === editingEmail) return cancelEditInvitee();
    if (!email) {
      // Cleared out — treat as removal.
      setInvitees(invitees.filter((e) => e !== editingEmail));
      return cancelEditInvitee();
    }
    if (!isEmail(email)) {
        setInviteeError(`"${email}" ไม่ใช่อีเมลที่ถูกต้อง`);
      return;
    }
    if (!isGmail(email)) {
        setInviteeError(`"${email}" ต้องเป็นอีเมล @gmail.com — การเข้าสู่ระบบใช้ Google`);
      return;
    }
    if (invitees.includes(email)) {
      // Already present elsewhere — drop the duplicate we were editing.
      setInvitees(invitees.filter((e) => e !== editingEmail));
      cancelEditInvitee();
      setInviteeError("");
      return;
    }
    setInvitees(invitees.map((e) => (e === editingEmail ? email : e)));
    cancelEditInvitee();
    setInviteeError("");
  }

  function onEditInviteeKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === ";") {
      e.preventDefault();
      commitEditInvitee();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEditInvitee();
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const latN = parseFloat(lat);
    const lngN = parseFloat(lng);
      if (!placeName.trim()) return setError("กรุณากรอกชื่อสถานที่");
      if (!localDate) return setError("กรุณาระบุวันที่/เวลา");
    if (!Number.isFinite(latN) || !Number.isFinite(lngN))
        return setError("ต้องระบุละติจูดและลองจิจูด (วางลิงก์ Maps แล้วกด Extract หรือกรอกเอง)");

    // Flush a half-typed invitee so it isn't silently dropped on save.
    const finalInvitees = inviteeDraft.trim() ? addInvitee(inviteeDraft) : invitees;

    onSave(
      {
        place_name: placeName.trim(),
        planned_date: localInputToISO(localDate),
        lat: latN,
        lng: lngN,
        maps_url: mapsUrl.trim(),
        category: category.trim(),
        notes,
        status,
        invitees: finalInvitees,
        notify,
      },
      initial?.id ?? null,
    );
  }

  const inputCls =
    "w-full rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 outline-none focus:border-pink-500";

  return (
    <form onSubmit={submit} className="space-y-3">
      <h2 className="text-lg font-semibold">{initial ? "แก้ไขสถานที่" : "เพิ่มสถานที่"}</h2>

      <label className="block text-sm">
        <span className="opacity-70">ลิงก์ Google Maps (ไม่บังคับ — ดึงชื่อ &amp; พิกัดอัตโนมัติ)</span>
        <div className="flex gap-2">
          <input
            className={inputCls}
            value={mapsUrl}
            onChange={(e) => setMapsUrl(e.target.value)}
            placeholder="https://maps.app.goo.gl/…"
          />
          <button
            type="button"
            onClick={onExtract}
            disabled={extracting || !mapsUrl.trim()}
            className="shrink-0 rounded-lg border border-black/15 dark:border-white/25 px-3 py-2 text-sm disabled:opacity-50"
          >
            {extracting ? "…" : "ดึงพิกัด"}
          </button>
        </div>
      </label>
      {hint && <p className="text-xs opacity-70">{hint}</p>}

      <label className="block text-sm">
        <span className="opacity-70">ชื่อสถานที่</span>
        <input className={inputCls} value={placeName} onChange={(e) => setPlaceName(e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">
          <span className="opacity-70">ละติจูด</span>
          <input className={inputCls} value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" />
        </label>
        <label className="block text-sm">
          <span className="opacity-70">ลองจิจูด</span>
          <input className={inputCls} value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" />
        </label>
      </div>

      <label className="block text-sm">
        <span className="opacity-70">วันเวลา (Asia/Bangkok)</span>
        <DateTimePicker value={localDate} onChange={setLocalDate} />
      </label>

      <div className="block text-sm">
        <span className="opacity-70">เชิญทางอีเมล (ไม่บังคับ)</span>
        <div
          className={`flex flex-wrap items-center gap-1.5 rounded-lg border border-black/15 dark:border-white/20 px-2 py-1.5 focus-within:border-pink-500`}
        >
          {invitees.map((email) =>
            editingEmail === email ? (
              <input
                key={email}
                type="email"
                autoFocus
                value={editDraft}
                onChange={(e) => {
                  setEditDraft(e.target.value);
                  if (inviteeError) setInviteeError("");
                }}
                onKeyDown={onEditInviteeKeyDown}
                onBlur={commitEditInvitee}
                aria-label={`แก้ไข ${email}`}
                className="min-w-[8rem] rounded-full bg-pink-100 px-2 py-0.5 text-xs text-pink-800 outline-none ring-1 ring-pink-400 dark:bg-pink-900/40 dark:text-pink-200"
              />
            ) : (
              <span
                key={email}
                onDoubleClick={() => startEditInvitee(email)}
                title="ดับเบิลคลิกเพื่อแก้ไข"
                className="flex cursor-pointer items-center gap-1 rounded-full bg-pink-100 px-2 py-0.5 text-xs text-pink-800 dark:bg-pink-900/40 dark:text-pink-200"
              >
                {email}
                <button
                  type="button"
                  onClick={() => removeInvitee(email)}
                  aria-label={`ลบ ${email}`}
                  className="leading-none opacity-60 hover:opacity-100"
                >
                  ×
                </button>
              </span>
            ),
          )}
          <input
            type="email"
            value={inviteeDraft}
            onChange={(e) => {
              setInviteeDraft(e.target.value);
              if (inviteeError) setInviteeError("");
            }}
            onKeyDown={onInviteeKeyDown}
            onBlur={() => inviteeDraft.trim() && addInvitee(inviteeDraft)}
            placeholder={invitees.length ? "เพิ่มอีกคน…" : "name@gmail.com"}
            className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 outline-none"
          />
        </div>
        <p className="mt-1 text-xs opacity-60">กด Enter หรือ comma เพื่อเพิ่ม ดับเบิลคลิกที่ชิปเพื่อแก้ไข</p>
        {inviteeError && <p className="mt-1 text-xs text-red-600">{inviteeError}</p>}

        {pendingRecipients.length > 0 ? (
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              ส่งคำเชิญปฏิทินทางอีเมล (จากคุณ) ไปยัง{" "}
              <span className="font-medium">{pendingRecipients.join(", ")}</span>
              {notify ? "" : " — จะไม่ส่ง"}
            </span>
          </label>
        ) : (
          invitees.length > 0 && (
            <p className="mt-1 text-xs opacity-60">
              ไม่มีผู้ถูกเชิญใหม่ที่ต้องส่งอีเมล — ทุกคนในรายการถูกเชิญไปแล้ว
            </p>
          )
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">
          <span className="opacity-70">หมวดหมู่</span>
          <input className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="opacity-70">สถานะ</span>
          <select
            className={inputCls}
            value={status}
            onChange={(e) => setStatus(e.target.value as PlaceStatus)}
          >
            <option value="planned">วางแผนไว้</option>
            <option value="visited">ไปแล้ว</option>
            <option value="cancelled">ยกเลิก</option>
          </select>
        </label>
      </div>

      <label className="block text-sm">
        <span className="opacity-70">บันทึก</span>
        <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {/* Attachments only make sense once the spot exists (it needs an id). */}
      {initial?.id && (
        <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
          <Attachments entityType="spot" entityId={initial.id} />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-pink-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {busy ? "กำลังบันทึก…" : initial ? "บันทึกการเปลี่ยนแปลง" : "เพิ่มสถานที่"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-black/15 dark:border-white/25 px-4 py-2"
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
}
