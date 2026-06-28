"use client";

import { useMemo, useState } from "react";
import { Swal, showLoading, showSuccess, showError } from "@/lib/swal";
import type { Milestone, Plan } from "@/lib/plans";
import { formatBangkok } from "@/lib/format";
import { nowBangkokISO, bangkokDateStr, isTodayBangkok } from "@/lib/dates";
import MilestoneForm, { type MilestonePayload } from "./MilestoneForm";

type MilestoneState = "done" | "overdue" | "today" | "upcoming";

// Derive the display state of a milestone (or dated checkpoint) from its dates.
function milestoneState(due: string, done: boolean): MilestoneState {
  if (done) return "done";
  if (isTodayBangkok(due)) return "today";
  const d = Date.parse(due);
  if (!Number.isNaN(d) && bangkokDateStr(new Date(d)) < bangkokDateStr()) return "overdue";
  return "upcoming";
}

const STATE_PILL: Record<MilestoneState, { label: string; cls: string }> = {
  done: { label: "done", cls: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" },
  overdue: { label: "overdue", cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
  today: { label: "due today", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  upcoming: { label: "upcoming", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" },
};

export default function TimelineView({
  plan,
  milestones,
  onBack,
  onMilestoneUpsert,
  onMilestoneRemove,
  onEditPlan,
}: {
  plan: Plan;
  milestones: Milestone[];
  onBack: () => void;
  onMilestoneUpsert: (m: Milestone) => void;
  onMilestoneRemove: (id: string) => void;
  onEditPlan: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Milestone | null>(null);
  const [notifyMembers, setNotifyMembers] = useState(false);

  const ordered = useMemo(
    () =>
      [...milestones].sort(
        (a, b) =>
          a.order_index - b.order_index ||
          (Date.parse(a.due_date) || 0) - (Date.parse(b.due_date) || 0),
      ),
    [milestones],
  );

  const summary = useMemo(() => {
    let overdue = 0;
    let today = 0;
    for (const m of ordered) {
      const s = milestoneState(m.due_date, m.status === "done");
      if (s === "overdue") overdue += 1;
      else if (s === "today") today += 1;
    }
    return { overdue, today };
  }, [ordered]);

  // PUT an action to a milestone and reflect the returned record locally.
  async function mutate(id: string, body: Record<string, unknown>, loading: string, ok: string) {
    setBusy(true);
    showLoading(loading);
    try {
      const res = await fetch(`/api/milestones/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showError(data.error ?? "Update failed");
        return;
      }
      onMilestoneUpsert(data.milestone as Milestone);
      showSuccess(ok);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveMilestone(payload: MilestonePayload, id: string | null) {
    setBusy(true);
    showLoading(id ? "Saving milestone…" : "Adding milestone…");
    try {
      const url = id ? `/api/milestones/${id}` : `/api/plans/${plan.id}/milestones`;
      const res = await fetch(url, {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showError(data.error ?? "Save failed");
        return;
      }
      onMilestoneUpsert(data.milestone as Milestone);
      setShowForm(false);
      setEditing(null);
      showSuccess(id ? "Milestone saved" : "Milestone added");
    } catch (e) {
      showError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  function confirm(m: Milestone) {
    mutate(m.id, { action: "confirm", notify: notifyMembers }, "Confirming…", "Marked done");
  }
  function reopen(m: Milestone) {
    mutate(m.id, { action: "reopen" }, "Reopening…", "Reopened");
  }
  function extendBy(m: Milestone, days: number) {
    const base = Date.parse(m.due_date);
    if (Number.isNaN(base)) return;
    const next = nowBangkokISO(new Date(base + days * 86_400_000));
    mutate(m.id, { action: "extend", due_date: next, notify: notifyMembers }, "Extending…", "Due date moved");
  }
  function toggleCheckpoint(m: Milestone, checkpointId: string) {
    mutate(
      m.id,
      { action: "checkpoint", op: "toggle", checkpoint: { id: checkpointId } },
      "Updating…",
      "Updated",
    );
  }

  async function onDelete(m: Milestone) {
    const c = await Swal.fire({
      title: "Delete this milestone?",
      text: "It will be removed from the timeline and calendar.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete",
      confirmButtonColor: "#dc2626",
    });
    if (!c.isConfirmed) return;
    showLoading("Deleting…");
    try {
      const res = await fetch(`/api/milestones/${m.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showError(data.error ?? "Delete failed");
        return;
      }
      onMilestoneRemove(m.id);
      showSuccess("Milestone deleted");
    } catch (e) {
      showError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <button onClick={onBack} className="text-sm underline opacity-70">
            ‹ All plans
          </button>
          <h2 className="text-lg font-semibold">{plan.title}</h2>
          {plan.description && <p className="text-sm opacity-70">{plan.description}</p>}
          {(summary.overdue > 0 || summary.today > 0) && (
            <p className="mt-1 text-sm">
              {summary.overdue > 0 && (
                <span className="mr-2 text-red-600">⚠️ {summary.overdue} overdue</span>
              )}
              {summary.today > 0 && <span className="text-amber-600">🔔 {summary.today} due today</span>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {plan.invitees.length > 0 && (
            <label className="flex items-center gap-1 text-xs opacity-70">
              <input
                type="checkbox"
                checked={notifyMembers}
                onChange={(e) => setNotifyMembers(e.target.checked)}
              />
              Email members on changes
            </label>
          )}
          <button onClick={onEditPlan} className="rounded-lg border border-black/15 dark:border-white/25 px-3 py-1.5 text-sm">
            Edit plan
          </button>
          <button
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
            className="rounded-lg bg-pink-600 px-3 py-1.5 text-sm font-medium text-white"
          >
            + Add milestone
          </button>
        </div>
      </div>

      {showForm && (
        <div className="rounded-xl border border-black/10 dark:border-white/15 p-4">
          <MilestoneForm
            key={editing?.id ?? "new"}
            initial={editing}
            busy={busy}
            onSave={onSaveMilestone}
            onCancel={() => {
              setShowForm(false);
              setEditing(null);
            }}
          />
        </div>
      )}

      {ordered.length === 0 ? (
        <p className="py-8 text-center text-sm opacity-60">
          No milestones yet. Add the first one (e.g. “บทที่ 1”).
        </p>
      ) : (
        <ol className="relative space-y-3 border-l border-black/10 pl-4 dark:border-white/15">
          {ordered.map((m) => {
            const state = milestoneState(m.due_date, m.status === "done");
            const pill = STATE_PILL[state];
            const early =
              m.status === "done" &&
              m.done_at &&
              Date.parse(m.done_at) < Date.parse(m.due_date);
            const doneCount = m.checkpoints.filter((c) => c.done).length;
            return (
              <li key={m.id} className="rounded-xl border border-black/10 dark:border-white/15 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{m.title}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${pill.cls}`}>{pill.label}</span>
                      {early && <span className="text-xs text-green-600">✓ early</span>}
                    </div>
                    <p className="text-sm opacity-70">{formatBangkok(m.due_date)}</p>
                    {m.notes && <p className="mt-1 text-sm opacity-80">{m.notes}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {m.status === "done" ? (
                      <button onClick={() => reopen(m)} disabled={busy} className={btnGhost}>
                        Reopen
                      </button>
                    ) : (
                      <>
                        <button onClick={() => confirm(m)} disabled={busy} className={btnPrimary}>
                          ✓ Confirm done
                        </button>
                        <button onClick={() => extendBy(m, 1)} disabled={busy} className={btnGhost}>
                          +1 day
                        </button>
                        <button onClick={() => extendBy(m, 7)} disabled={busy} className={btnGhost}>
                          +1 week
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => {
                        setEditing(m);
                        setShowForm(true);
                      }}
                      className={btnGhost}
                    >
                      Edit
                    </button>
                    <button onClick={() => onDelete(m)} className={btnGhost}>
                      Delete
                    </button>
                  </div>
                </div>

                {m.checkpoints.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-black/5 pt-2 dark:border-white/10">
                    {m.checkpoints.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={c.done}
                          disabled={busy}
                          onChange={() => toggleCheckpoint(m, c.id)}
                        />
                        <span className={c.done ? "line-through opacity-60" : ""}>{c.title}</span>
                        {c.due_date && (
                          <span className="text-xs opacity-50">· {formatBangkok(c.due_date)}</span>
                        )}
                      </li>
                    ))}
                    <li className="pt-1 text-xs opacity-50">
                      {doneCount}/{m.checkpoints.length} checkpoints done
                    </li>
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

const btnPrimary = "rounded-lg bg-pink-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-black/15 dark:border-white/25 px-2.5 py-1 text-xs disabled:opacity-50";
