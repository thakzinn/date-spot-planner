"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Swal, showLoading, showSuccess, showError } from "@/lib/swal";
import type { Checkpoint, Milestone, Plan } from "@/lib/plans";
import type { AttachmentEntity, AttachmentPublic } from "@/lib/attachments";
import { formatBangkok } from "@/lib/format";
import { nowBangkokISO, bangkokDateStr, isTodayBangkok } from "@/lib/dates";
import MilestoneForm, { type MilestonePayload } from "./MilestoneForm";
import Attachments from "./Attachments";
import CollapsibleText from "./CollapsibleText";

type MilestoneState = "done" | "overdue" | "today" | "upcoming";
const FOCUS_PREVIEW_LIMIT = 8;

// Derive the display state of a milestone (or dated checkpoint) from its dates.
function milestoneState(due: string, done: boolean): MilestoneState {
  if (done) return "done";
  if (isTodayBangkok(due)) return "today";
  const d = Date.parse(due);
  if (!Number.isNaN(d) && bangkokDateStr(new Date(d)) < bangkokDateStr()) return "overdue";
  return "upcoming";
}

function checkpointEffectiveDueDate(checkpoint: Checkpoint, milestoneDue: string): string {
  return checkpoint.due_date || milestoneDue;
}

function checkpointSortWeight(checkpoint: Checkpoint, milestoneDue: string): number {
  if (checkpoint.done) return 3;
  const state = milestoneState(checkpointEffectiveDueDate(checkpoint, milestoneDue), false);
  if (state === "overdue") return 0;
  if (state === "today") return 1;
  return 2;
}

const STATE_PILL: Record<MilestoneState, { label: string; cls: string }> = {
  done: { label: "เสร็จแล้ว", cls: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" },
  overdue: { label: "เลยกำหนด", cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
  today: { label: "ครบกำหนดวันนี้", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  upcoming: { label: "กำลังจะถึง", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" },
};

// Colour of the timeline point (the dot on the track) per state.
const STATE_DOT: Record<MilestoneState, string> = {
  done: "bg-green-500",
  overdue: "bg-red-500",
  today: "bg-amber-500",
  upcoming: "bg-pink-500",
};

// Live, second-by-second countdown to a due date. Shows how far out the date
// is ("อีก 18 วัน 5:32:10") and flips to an overdue read-out once it passes.
function Countdown({ due, done }: { due: string; done?: boolean }) {
  const target = Date.parse(due);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (done || Number.isNaN(target)) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [done, target]);

  if (Number.isNaN(target) || done) return null;

  const diff = target - now;
  const overdue = diff < 0;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const s = Math.floor((abs % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = `${pad(h)}:${pad(m)}:${pad(s)}`;
  const dayPart = days > 0 ? `${days} วัน ` : "";

  return (
    <span className={`text-xs tabular-nums ${overdue ? "text-red-600" : "opacity-70"}`}>
      {overdue ? `เลยมาแล้ว ${dayPart}${clock}` : `อีก ${dayPart}${clock}`}
    </span>
  );
}

// Small read-only chips listing who is responsible for a milestone/checkpoint.
function AssigneeChips({ emails }: { emails: string[] }) {
  if (emails.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {emails.map((e) => (
        <span
          key={e}
          title={e}
          className="rounded-full bg-pink-100 px-2 py-0.5 text-xs text-pink-800 dark:bg-pink-900/40 dark:text-pink-200"
        >
          @{e.split("@")[0]}
        </span>
      ))}
    </span>
  );
}

const btnPrimary = "rounded-lg bg-pink-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-black/15 dark:border-white/25 px-2.5 py-1 text-xs disabled:opacity-50";

export default function TimelineView({
  plan,
  isOwner,
  milestones,
  onBack,
  onMilestoneUpsert,
  onMilestoneRemove,
  onEditPlan,
}: {
  plan: Plan;
  isOwner: boolean;
  milestones: Milestone[];
  onBack: () => void;
  onMilestoneUpsert: (m: Milestone) => void;
  onMilestoneRemove: (id: string) => void;
  onEditPlan: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Milestone | null>(null);
  // The form renders at the top of the view; when it opens (Edit / Add) scroll
  // it into view so the user sees it instead of silently jumping past it.
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (showForm) formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [showForm, editing]);
  const [notifyMembers, setNotifyMembers] = useState(false);
  // Which checkpoint's inline date editor is open (by checkpoint id), or null.
  const [openCheckpoint, setOpenCheckpoint] = useState<string | null>(null);

  // People who can be assigned to a milestone/checkpoint: the plan creator plus
  // everyone invited, lowercased and de-duped (so the picker matches the emails
  // the server stores on the milestone).
  const members = useMemo(() => {
    const all = [plan.created_by.trim().toLowerCase(), ...plan.invitees].filter(Boolean);
    return [...new Set(all)];
  }, [plan.created_by, plan.invitees]);

  // All attachments for this plan + its milestones, fetched ONCE (not one
  // request per panel). `null` while loading; afterward a map keyed
  // `"<type>:<id>"`. Each <Attachments> is seeded from this and skips its own
  // fetch, so the timeline stays well under the Sheets read quota.
  const [attachments, setAttachments] = useState<Record<string, AttachmentPublic[]> | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/attachments?plan_id=${encodeURIComponent(plan.id)}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (cancelled) return;
        const map: Record<string, AttachmentPublic[]> = {};
        if (data.ok) {
          for (const a of data.attachments as AttachmentPublic[]) {
            (map[`${a.entity_type}:${a.entity_id}`] ??= []).push(a);
          }
        }
        setAttachments(map);
      } catch {
        if (!cancelled) setAttachments({}); // degrade to empty seeds, still uploadable
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plan.id]);

  const attInitial = (type: AttachmentEntity, id: string): AttachmentPublic[] =>
    attachments?.[`${type}:${id}`] ?? [];

  // Chronological by due_date so the spine reads top-to-bottom in time;
  // order_index only breaks ties between milestones sharing a due date/time.
  const ordered = useMemo(
    () =>
      [...milestones].sort(
        (a, b) =>
          (Date.parse(a.due_date) || 0) - (Date.parse(b.due_date) || 0) ||
          a.order_index - b.order_index,
      ),
    [milestones],
  );

  // Each milestone owns the spine leg *below* its own dot (the stretch beside
  // its card). We colour those legs:
  //  • green   — legs of milestones already done
  //  • rainbow — only the leg of the current in-progress milestone (first
  //              not-done) toward the next dot — that's the part being worked on
  //  • faint   — everything after (not yet reached; the plain pseudo-element)
  // `boundaryId` is the dot where green ends and the rainbow begins (the
  // in-progress milestone's dot); `rainEndId` is the dot the rainbow runs to
  // (the milestone right after it, or the plan-due point).
  const { boundaryId, rainEndId } = useMemo(() => {
    const idx = ordered.findIndex((m) => m.status !== "done");
    const planDue = plan.due_date ? "__plan_due__" : null;
    if (idx === -1) {
      // Every milestone is done — green covers them all, the rainbow runs the
      // final leg toward the plan-due point.
      return { boundaryId: ordered.length ? ordered[ordered.length - 1].id : null, rainEndId: planDue };
    }
    return {
      boundaryId: ordered[idx].id,
      rainEndId: idx + 1 < ordered.length ? ordered[idx + 1].id : planDue,
    };
  }, [ordered, plan.due_date]);

  // Measure the pixel offsets of the segments. Re-measure when the layout
  // changes (cards expanding, viewport resizing).
  const trackRef = useRef<HTMLOListElement>(null);
  const boundaryRef = useRef<HTMLLIElement>(null);
  const rainEndRef = useRef<HTMLLIElement>(null);
  const [runTop, setRunTop] = useState(0);
  const [runHeight, setRunHeight] = useState(0);
  const [greenTop, setGreenTop] = useState(0);
  const [greenHeight, setGreenHeight] = useState(0);
  // Where the faint base spine ends — the centre of the last dot on the track.
  const [trackHeight, setTrackHeight] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => {
      const ol = trackRef.current;
      // Each dot sits at top-1.5 (6px) and is h-4 (16px) → centre is 14px down.
      // Only the ol's *direct* children are track points — `li` would also match
      // nested checkpoint <li>s inside the cards, so scope to direct children.
      const points = ol ? ol.querySelectorAll<HTMLLIElement>(":scope > li") : null;
      const firstLi = points?.[0] ?? null;
      // End the spine at the last dot's centre so it doesn't trail past it.
      const lastLi = points?.length ? points[points.length - 1] : null;
      setTrackHeight(lastLi ? lastLi.offsetTop + 14 : null);
      // Start at the first dot's lower edge (centre 14 + radius ≈ 20) so the
      // line's rounded cap tucks under the circle instead of poking above it.
      const start = firstLi ? firstLi.offsetTop + 20 : 0;
      const boundaryC = boundaryRef.current ? boundaryRef.current.offsetTop + 14 : null;
      const rainEndC = rainEndRef.current ? rainEndRef.current.offsetTop + 14 : null;

      // Green: from the top down to (and into) the in-progress dot.
      setGreenTop(start);
      setGreenHeight(boundaryC != null ? Math.max(0, boundaryC - start) : 0);

      // Rainbow: from the in-progress dot down to the next dot after it.
      const rainStart = boundaryC ?? start;
      setRunTop(rainStart);
      setRunHeight(rainEndC != null ? Math.max(0, rainEndC - rainStart) : 0);
    };
    measure();
    const ol = trackRef.current;
    if (!ol) return;
    const ro = new ResizeObserver(measure);
    ro.observe(ol);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ordered, boundaryId, rainEndId]);

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

  const nextMilestoneDue = useMemo(() => {
    const next = ordered.find((m) => m.status !== "done");
    if (!next) return null;
    const due = Date.parse(next.due_date);
    if (Number.isNaN(due)) return null;
    return due;
  }, [ordered]);

  const focusCheckpoints = useMemo(() => {
    if (nextMilestoneDue == null) return [];
    const nextMilestoneDay = bangkokDateStr(new Date(nextMilestoneDue));
    const list: Array<{
      milestone: Milestone;
      checkpoint: Checkpoint;
      due: string;
      state: MilestoneState;
      beforeMilestone: boolean;
      sameDayAsMilestone: boolean;
      weight: number;
    }> = [];
    for (const m of ordered) {
      for (const c of m.checkpoints) {
        if (c.done) continue;
        const due = checkpointEffectiveDueDate(c, m.due_date);
        const dueTime = Date.parse(due);
        if (Number.isNaN(dueTime)) continue;
        const dueDay = bangkokDateStr(new Date(dueTime));
        if (dueDay > nextMilestoneDay) continue;
        const milestoneDue = Date.parse(m.due_date);
        if (Number.isNaN(milestoneDue)) continue;
        const milestoneDay = bangkokDateStr(new Date(milestoneDue));
        const beforeMilestone = dueDay <= milestoneDay;
        const sameDayAsMilestone = dueDay === milestoneDay;
        if (!beforeMilestone) continue;
        const state = milestoneState(due, false);
        const weight = state === "overdue" ? 0 : state === "today" ? 1 : beforeMilestone ? 2 : 3;
        list.push({ milestone: m, checkpoint: c, due, state, beforeMilestone, sameDayAsMilestone, weight });
      }
    }
    return list.sort((a, b) => {
      if (a.weight !== b.weight) return a.weight - b.weight;
      const aDue = Date.parse(a.due);
      const bDue = Date.parse(b.due);
      if (!Number.isNaN(aDue) && !Number.isNaN(bDue) && aDue !== bDue) return aDue - bDue;
      return a.checkpoint.title.localeCompare(b.checkpoint.title, "th");
    });
  }, [ordered, nextMilestoneDue]);

  // PUT an action to a milestone and reflect the returned record locally.
  // Returns the updated milestone, or null if the request failed.
  async function mutate(
    id: string,
    body: Record<string, unknown>,
    loading: string,
    ok: string,
  ): Promise<Milestone | null> {
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
        showError(data.error ?? "อัปเดตไม่สำเร็จ");
        return null;
      }
      const updated = data.milestone as Milestone;
      onMilestoneUpsert(updated);
      showSuccess(ok);
      return updated;
    } catch (e) {
      showError(e instanceof Error ? e.message : "อัปเดตไม่สำเร็จ");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onSaveMilestone(payload: MilestonePayload, id: string | null) {
    setBusy(true);
    showLoading(id ? "กำลังบันทึก milestone…" : "กำลังเพิ่ม milestone…");
    try {
      const url = id ? `/api/milestones/${id}` : `/api/plans/${plan.id}/milestones`;
      const res = await fetch(url, {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showError(data.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      onMilestoneUpsert(data.milestone as Milestone);
      setShowForm(false);
      setEditing(null);
      showSuccess(id ? "บันทึก milestone แล้ว" : "เพิ่ม milestone แล้ว");
    } catch (e) {
      showError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  function confirm(m: Milestone) {
    mutate(m.id, { action: "confirm", notify: notifyMembers }, "กำลังยืนยัน…", "ทำเครื่องหมายว่าเสร็จแล้ว");
  }
  function reopen(m: Milestone) {
    mutate(m.id, { action: "reopen" }, "กำลังเปิดใหม่…", "เปิดใหม่แล้ว");
  }
  function extendBy(m: Milestone, days: number) {
    const base = Date.parse(m.due_date);
    if (Number.isNaN(base)) return;
    const next = nowBangkokISO(new Date(base + days * 86_400_000));
    // Don't let a quick-extend push a milestone past the plan's overall due.
    if (plan.due_date && Date.parse(next) > Date.parse(plan.due_date)) {
      showError(`เลื่อนเกินวันครบกำหนดของแผนไม่ได้ (${formatBangkok(plan.due_date)}) กรุณาเลื่อนแผนก่อน`);
      return;
    }
    mutate(m.id, { action: "extend", due_date: next, notify: notifyMembers }, "กำลังเลื่อน…", "เลื่อนวันครบกำหนดแล้ว");
  }
  async function toggleCheckpoint(m: Milestone, checkpointId: string) {
    const updated = await mutate(
      m.id,
      { action: "checkpoint", op: "toggle", checkpoint: { id: checkpointId } },
      "กำลังอัปเดต…",
      "อัปเดตแล้ว",
    );
    if (!updated) return;
    const allChecked =
      updated.checkpoints.length > 0 && updated.checkpoints.every((c) => c.done);
    // Auto-confirm the milestone once every checkpoint is ticked off…
    if (updated.status !== "done" && allChecked) {
      confirm(updated);
    }
    // …and auto-reopen it if a checkpoint is un-ticked while it's already done,
    // so the milestone can't stay "done" with outstanding checkpoints.
    else if (updated.status === "done" && !allChecked) {
      reopen(updated);
    }
  }
  // Move a checkpoint's own due date out (+) or in (-) by N days. A checkpoint
  // with no date of its own ("due with the milestone") is shifted from the
  // milestone's due date as the base.
  function shiftCheckpoint(m: Milestone, c: Checkpoint, days: number) {
    const base = Date.parse(c.due_date || m.due_date);
    if (Number.isNaN(base)) return;
    const next = nowBangkokISO(new Date(base + days * 86_400_000));
    // A checkpoint is a step toward its milestone — it can't fall due after it.
    if (m.due_date && Date.parse(next) > Date.parse(m.due_date)) {
        showError(`เลื่อนเกินวันครบกำหนดของ milestone ไม่ได้ (${formatBangkok(m.due_date)}) กรุณาเลื่อน milestone ก่อน`);
      return;
    }
    if (plan.due_date && Date.parse(next) > Date.parse(plan.due_date)) {
        showError(`เลื่อนเกินวันครบกำหนดของแผนไม่ได้ (${formatBangkok(plan.due_date)}) กรุณาเลื่อนแผนก่อน`);
      return;
    }
    mutate(
      m.id,
      { action: "checkpoint", op: "edit", checkpoint: { id: c.id, due_date: next } },
        "กำลังเลื่อน…",
        "เลื่อนวันที่แล้ว",
    );
  }

  async function onDelete(m: Milestone) {
    const c = await Swal.fire({
        title: "ลบ milestone นี้?",
        text: "จะถูกลบออกจากไทม์ไลน์และปฏิทิน",
      icon: "warning",
      showCancelButton: true,
        confirmButtonText: "ลบ",
      confirmButtonColor: "#dc2626",
    });
    if (!c.isConfirmed) return;
      showLoading("กำลังลบ…");
    try {
      const res = await fetch(`/api/milestones/${m.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
          showError(data.error ?? "ลบไม่สำเร็จ");
        return;
      }
      onMilestoneRemove(m.id);
        showSuccess("ลบ milestone แล้ว");
    } catch (e) {
        showError(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <button onClick={onBack} className="text-sm underline opacity-70">
            ‹ แผนทั้งหมด
          </button>
          <h2 className="text-lg font-semibold">{plan.title}</h2>
          {plan.description && (
            <CollapsibleText text={plan.description} className="text-sm opacity-70" lines={4} />
          )}
          {attachments !== null && (
            <div className="mt-2 max-w-md">
              <Attachments
                entityType="plan"
                entityId={plan.id}
                initial={attInitial("plan", plan.id)}
              />
            </div>
          )}
          {(summary.overdue > 0 || summary.today > 0) && (
            <p className="mt-1 text-sm">
              {summary.overdue > 0 && <span className="mr-2 text-red-600">⚠️ เลยกำหนด {summary.overdue}</span>}
              {summary.today > 0 && <span className="text-amber-600">🔔 ครบกำหนดวันนี้ {summary.today}</span>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {plan.invitees.length > 0 && (
            <label className="flex items-center gap-1 text-xs opacity-70">
              <input type="checkbox" checked={notifyMembers} onChange={(e) => setNotifyMembers(e.target.checked)} />
              ส่งอีเมลแจ้งสมาชิกเมื่อมีการเปลี่ยนแปลง
            </label>
          )}
          {isOwner && (
            <button onClick={onEditPlan} className="rounded-lg border border-black/15 dark:border-white/25 px-3 py-1.5 text-sm">
              แก้ไขแผน
            </button>
          )}
          <button
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
            className="rounded-lg bg-pink-600 px-3 py-1.5 text-sm font-medium text-white"
          >
            + เพิ่ม milestone
          </button>
        </div>
      </div>

      {showForm && (
        <div ref={formRef} className="scroll-mt-4 rounded-xl border border-black/10 dark:border-white/15 p-4">
          <MilestoneForm
            key={editing?.id ?? "new"}
            initial={editing}
            busy={busy}
            planDue={plan.due_date}
            members={members}
            onSave={onSaveMilestone}
            onCancel={() => {
              setShowForm(false);
              setEditing(null);
            }}
          />
        </div>
      )}

      {focusCheckpoints.length > 0 && (
        <section className="rounded-xl border border-pink-500/30 bg-pink-50/40 p-3 dark:border-pink-400/25 dark:bg-pink-950/20">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">🎯 งานก่อน milestone (Checkpoint)</h3>
            <span className="text-xs opacity-60">{focusCheckpoints.length} รายการที่ยังไม่เสร็จ</span>
          </div>
          <ul className="space-y-1.5">
            {focusCheckpoints.slice(0, FOCUS_PREVIEW_LIMIT).map((item) => {
              const pill = STATE_PILL[item.state];
              const cp = item.checkpoint;
              const cpKey = cp.id || `${item.milestone.id}:${cp.title}`;
              return (
                <li
                  key={cpKey}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-black/10 bg-white/75 px-2.5 py-2 text-sm dark:border-white/15 dark:bg-zinc-900/60"
                >
                  <input
                    type="checkbox"
                    checked={cp.done}
                    disabled={busy || !cp.id}
                    onChange={() => toggleCheckpoint(item.milestone, cp.id)}
                    title={cp.id ? "เช็คเสร็จ" : "checkpoint นี้ยังไม่มี id จึงยังเช็คจากลิสต์นี้ไม่ได้"}
                  />
                  <span className="font-medium">{cp.title}</span>
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200">
                    {item.milestone.title}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${pill.cls}`}>{pill.label}</span>
                  {item.beforeMilestone && (
                    <span className="rounded-full bg-pink-100 px-2 py-0.5 text-xs text-pink-800 dark:bg-pink-900/40 dark:text-pink-200">
                      โฟกัสก่อน milestone
                    </span>
                  )}
                  {item.sameDayAsMilestone && (
                    <span className="rounded-full bg-fuchsia-100 px-2 py-0.5 text-xs text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-200">
                      วันเดียวกับ milestone
                    </span>
                  )}
                  <span className="text-xs opacity-60">· {formatBangkok(item.due)}</span>
                  <Countdown due={item.due} done={false} />
                </li>
              );
            })}
          </ul>
          {focusCheckpoints.length > FOCUS_PREVIEW_LIMIT && (
            <p className="mt-2 text-xs opacity-60">และอีก {focusCheckpoints.length - FOCUS_PREVIEW_LIMIT} รายการใน milestone ด้านล่าง</p>
          )}
        </section>
      )}

      {ordered.length === 0 ? (
        <p className="py-8 text-center text-sm opacity-60">
          ยังไม่มี milestone เพิ่มอันแรก (เช่น “บทที่ 1”)
        </p>
      ) : (
        // Vertical timeline: a track line on the left, a coloured point per
        // milestone, the due date as a pill, and the full card beside it.
        <ol
          ref={trackRef}
          className="timeline-track relative ms-2"
          style={trackHeight != null ? { ["--track-height" as string]: `${trackHeight}px` } : undefined}
        >
          {greenHeight > 0 && (
            <span
              className="timeline-done"
              style={{ top: greenTop, height: greenHeight }}
              aria-hidden
            />
          )}
          {runHeight > 0 && (
            <span
              className="timeline-run"
              style={{ top: runTop, height: runHeight }}
              aria-hidden
            />
          )}
          {ordered.map((m) => {
            const state = milestoneState(m.due_date, m.status === "done");
            const pill = STATE_PILL[state];
            const early =
              m.status === "done" && m.done_at && Date.parse(m.done_at) < Date.parse(m.due_date);
            const doneCount = m.checkpoints.filter((c) => c.done).length;
            const sortedCheckpoints = [...m.checkpoints].sort((a, b) => {
              const weight = checkpointSortWeight(a, m.due_date) - checkpointSortWeight(b, m.due_date);
              if (weight !== 0) return weight;
              const aDue = Date.parse(checkpointEffectiveDueDate(a, m.due_date));
              const bDue = Date.parse(checkpointEffectiveDueDate(b, m.due_date));
              if (!Number.isNaN(aDue) && !Number.isNaN(bDue) && aDue !== bDue) return aDue - bDue;
              return a.title.localeCompare(b.title, "th");
            });
            return (
              <li
                key={m.id}
                ref={
                  m.id === boundaryId ? boundaryRef : m.id === rainEndId ? rainEndRef : undefined
                }
                className="relative mb-8 ms-6"
              >
                <span
                  className={`absolute -start-[33px] top-1.5 h-4 w-4 rounded-full ring-4 ring-white dark:ring-zinc-950 ${STATE_DOT[state]}`}
                  aria-hidden
                />
                <div className="mb-2 inline-flex items-center rounded-full bg-pink-600 px-3 py-1 text-xs font-semibold text-white">
                  {formatBangkok(m.due_date)}
                </div>

                <div className="rounded-xl border border-black/10 bg-white p-3 shadow-sm dark:border-white/15 dark:bg-zinc-900">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{m.title}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${pill.cls}`}>{pill.label}</span>
                    <Countdown due={m.due_date} done={m.status === "done"} />
                    {m.status === "done" && m.done_at && (
                      <span className="text-xs text-green-600">
                        ✓ เสร็จ {formatBangkok(m.done_at)}{early ? " · ก่อนกำหนด" : ""}
                      </span>
                    )}
                  </div>
                  {m.notes && <p className="mt-1 text-sm opacity-80">{m.notes}</p>}
                  {m.assignees.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs">
                      <span className="opacity-50">ผู้รับผิดชอบ:</span>
                      <AssigneeChips emails={m.assignees} />
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.status === "done" ? (
                      <button onClick={() => reopen(m)} disabled={busy} className={btnGhost}>
                        เปิดใหม่
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => confirm(m)}
                          disabled={busy}
                          title={
                            doneCount < m.checkpoints.length
                              ? "ยืนยันว่าเสร็จ และเช็คถูก checkpoint ที่เหลือทั้งหมด"
                              : undefined
                          }
                          className={btnPrimary}
                        >
                          ✓ ยืนยันเสร็จ
                        </button>
                        <button onClick={() => extendBy(m, 1)} disabled={busy} className={btnGhost}>
                          +1 วัน
                        </button>
                        <button onClick={() => extendBy(m, 7)} disabled={busy} className={btnGhost}>
                          +1 สัปดาห์
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
                      แก้ไข
                    </button>
                    <button onClick={() => onDelete(m)} className={btnGhost}>
                      ลบ
                    </button>
                  </div>

                  {m.checkpoints.length > 0 && (
                    <ul className="mt-2 space-y-1 border-t border-black/5 pt-2 dark:border-white/10">
                      {sortedCheckpoints.map((c) => {
                        const cpDue = checkpointEffectiveDueDate(c, m.due_date);
                        const cpState = milestoneState(cpDue, c.done);
                        const cpPill = STATE_PILL[cpState];
                        const beforeMilestone =
                          !!c.due_date &&
                          !Number.isNaN(Date.parse(c.due_date)) &&
                          Date.parse(c.due_date) < Date.parse(m.due_date);
                        return (
                        <li key={c.id} className="text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="checkbox"
                              checked={c.done}
                              disabled={busy}
                              onChange={() => toggleCheckpoint(m, c.id)}
                            />
                            {/* Click the title to reveal inline date controls. */}
                            <button
                              type="button"
                              onClick={() => setOpenCheckpoint((id) => (id === c.id ? null : c.id))}
                              title="คลิกเพื่อปรับวันที่"
                              className={`text-left hover:underline ${c.done ? "line-through opacity-60" : ""}`}
                            >
                              {c.title}
                            </button>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] ${cpPill.cls}`}>{cpPill.label}</span>
                            {beforeMilestone && !c.done && (
                              <span className="rounded-full bg-pink-100 px-2 py-0.5 text-[11px] text-pink-800 dark:bg-pink-900/40 dark:text-pink-200">
                                โฟกัสก่อน milestone
                              </span>
                            )}
                            {c.due_date && <span className="text-xs opacity-50">· {formatBangkok(c.due_date)}</span>}
                            {c.due_date && <Countdown due={c.due_date} done={c.done} />}
                            {c.assignees.length > 0 && <AssigneeChips emails={c.assignees} />}
                            {c.done && c.done_at && (
                              <span className="text-xs text-green-600">✓ เช็ค {formatBangkok(c.done_at)}</span>
                            )}
                          </div>
                          {openCheckpoint === c.id && (
                            <div className="ms-6 mt-1 flex flex-wrap items-center gap-1.5">
                              <span className="text-xs opacity-50">ปรับวันที่:</span>
                              <button onClick={() => shiftCheckpoint(m, c, -7)} disabled={busy} className={btnGhost}>
                                  -1 สัปดาห์
                              </button>
                              <button onClick={() => shiftCheckpoint(m, c, -1)} disabled={busy} className={btnGhost}>
                                  -1 วัน
                              </button>
                              <button onClick={() => shiftCheckpoint(m, c, 1)} disabled={busy} className={btnGhost}>
                                  +1 วัน
                              </button>
                              <button onClick={() => shiftCheckpoint(m, c, 7)} disabled={busy} className={btnGhost}>
                                  +1 สัปดาห์
                              </button>
                            </div>
                          )}
                        </li>
                        );
                      })}
                      <li className="pt-1 text-xs opacity-50">
                        {doneCount}/{m.checkpoints.length} checkpoint เสร็จแล้ว
                      </li>
                    </ul>
                  )}

                  {attachments !== null && (
                    <div className="mt-2 border-t border-black/5 pt-2 dark:border-white/10">
                      <Attachments
                        entityType="milestone"
                        entityId={m.id}
                        initial={attInitial("milestone", m.id)}
                      />
                    </div>
                  )}
                </div>
              </li>
            );
          })}

          {plan.due_date && (() => {
            // Final point on the track: the plan's overall due date.
            const state = milestoneState(plan.due_date, false);
            return (
              <li
                ref={rainEndId === "__plan_due__" ? rainEndRef : undefined}
                className="relative mb-2 ms-6"
              >
                <span
                  className={`absolute -start-[33px] top-1.5 h-4 w-4 rounded-full ring-4 ring-white dark:ring-zinc-950 ${STATE_DOT[state]}`}
                  aria-hidden
                />
                <div className="mb-2 inline-flex items-center rounded-full bg-pink-600 px-3 py-1 text-xs font-semibold text-white">
                  {formatBangkok(plan.due_date)}
                </div>

                <div className="rounded-xl border border-pink-500/30 bg-pink-50 p-3 shadow-sm dark:border-pink-400/25 dark:bg-pink-950/20">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">🎯 กำหนดของแผน</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATE_PILL[state].cls}`}>
                      {STATE_PILL[state].label}
                    </span>
                    <Countdown due={plan.due_date} />
                  </div>
                  <p className="mt-1 text-sm opacity-80">{plan.title}</p>
                </div>
              </li>
            );
          })()}
        </ol>
      )}
    </div>
  );
}
