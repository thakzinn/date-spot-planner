"use client";

import { useState } from "react";
import type { Checkpoint, Milestone } from "@/lib/plans";
import { formatBangkok, isoToLocalInput, localInputToISO } from "@/lib/format";
import DateTimePicker from "./DateTimePicker";

export interface MilestonePayload {
  title: string;
  notes: string;
  due_date: string; // ISO with offset
  checkpoints: Checkpoint[];
}

// Local editing shape for a checkpoint row (date held as datetime-local value).
interface Row {
  id: string;
  title: string;
  localDate: string;
  done: boolean;
  done_at: string;
}

let rowSeq = 0;
function newRowKey(): string {
  rowSeq += 1;
  return `row_${rowSeq}`;
}

export default function MilestoneForm({
  initial,
  busy,
  planDue,
  onSave,
  onCancel,
}: {
  initial: Milestone | null;
  busy: boolean;
  planDue?: string; // plan's overall due date (ISO) — milestones can't exceed it
  onSave: (payload: MilestonePayload, id: string | null) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [localDate, setLocalDate] = useState(initial ? isoToLocalInput(initial.due_date) : "");
  const [rows, setRows] = useState<Row[]>(
    (initial?.checkpoints ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      localDate: c.due_date ? isoToLocalInput(c.due_date) : "",
      done: c.done,
      done_at: c.done_at,
    })),
  );
  const [error, setError] = useState("");

  function addRow() {
    setRows((r) => [...r, { id: newRowKey(), title: "", localDate: "", done: false, done_at: "" }]);
  }
  function updateRow(id: string, patch: Partial<Row>) {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }
  function removeRow(id: string) {
    setRows((r) => r.filter((row) => row.id !== id));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!title.trim()) return setError("Title is required.");
    if (!localDate) return setError("A due date/time is required.");

    const dueISO = localInputToISO(localDate);
    const checkpoints: Checkpoint[] = rows
      .filter((row) => row.title.trim())
      .map((row) => ({
        // Preserve persisted ids (ms_/cp_…); drop synthetic row_ keys so the
        // server stamps a real id for brand-new rows.
        id: row.id.startsWith("row_") ? "" : row.id,
        title: row.title.trim(),
        due_date: row.localDate ? localInputToISO(row.localDate) : "",
        done: row.done,
        done_at: row.done_at,
      }));

    // Enforce the plan deadline up front (the server re-checks too).
    if (planDue) {
      const limit = Date.parse(planDue);
      if (Date.parse(dueISO) > limit) {
        return setError(`Due must be on or before the plan's due date (${formatBangkok(planDue)}).`);
      }
      const lateCp = checkpoints.find((c) => c.due_date && Date.parse(c.due_date) > limit);
      if (lateCp) {
        return setError(`Checkpoint “${lateCp.title}” is after the plan's due date (${formatBangkok(planDue)}).`);
      }
    }

    onSave({ title: title.trim(), notes, due_date: dueISO, checkpoints }, initial?.id ?? null);
  }

  const inputCls =
    "w-full rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 outline-none focus:border-pink-500";

  return (
    <form onSubmit={submit} className="space-y-3">
      <h3 className="font-semibold">{initial ? "Edit milestone" : "Add milestone"}</h3>

      <label className="block text-sm">
        <span className="opacity-70">Title (e.g. “บทที่ 1”)</span>
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      <label className="block text-sm">
        <span className="opacity-70">Due (Asia/Bangkok)</span>
        <DateTimePicker value={localDate} onChange={setLocalDate} />
        {planDue && (
          <span className="mt-1 block text-xs opacity-60">
            Plan due: {formatBangkok(planDue)} — must be on or before this.
          </span>
        )}
      </label>

      <label className="block text-sm">
        <span className="opacity-70">Notes (optional)</span>
        <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div className="text-sm">
        <span className="opacity-70">Checkpoints (optional — each can have its own date)</span>
        <div className="mt-1 space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="rounded-lg border border-black/10 dark:border-white/15 p-2">
              <div className="flex items-center gap-2">
                <input
                  className={inputCls}
                  value={row.title}
                  placeholder="What needs doing"
                  onChange={(e) => updateRow(row.id, { title: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  aria-label="Remove checkpoint"
                  className="shrink-0 rounded-lg border border-black/15 dark:border-white/25 px-2 py-2 text-sm"
                >
                  ×
                </button>
              </div>
              <div className="mt-1">
                <DateTimePicker
                  value={row.localDate}
                  onChange={(v) => updateRow(row.id, { localDate: v })}
                />
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addRow}
          className="mt-2 rounded-lg border border-black/15 dark:border-white/25 px-3 py-1.5 text-sm"
        >
          + Add checkpoint
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-pink-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : initial ? "Save changes" : "Add milestone"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-black/15 dark:border-white/25 px-4 py-2"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
