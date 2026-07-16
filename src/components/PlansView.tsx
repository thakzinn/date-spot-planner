"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Swal, showLoading, showSuccess, showError } from "@/lib/swal";
import { isGmail, type Milestone, type Plan } from "@/lib/plans";
import { bangkokDateStr, isTodayBangkok } from "@/lib/dates";
import { formatBangkok, isoToLocalInput, localInputToISO } from "@/lib/format";
import DateTimePicker from "./DateTimePicker";
import TimelineView from "./TimelineView";
import Segmented from "./Segmented";
import CollapsibleText from "./CollapsibleText";

interface PlanPayload {
  title: string;
  description: string;
  invitees: string[];
  due_date: string;
}

type PlanScope = "me" | "invited" | "all";
type PlanPeriod = "current" | "past" | "all";

export default function PlansView({
  userEmail,
}: {
  userEmail: string;
  userName?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPlanForm, setShowPlanForm] = useState(() => searchParams.get("new") === "1");
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  // Who owns the plan (Me / Invited / All) and where it sits in time
  // (Current = active & not past due, Past = done/archived or overdue).
  const [scope, setScope] = useState<PlanScope>("all");
  const [period, setPeriod] = useState<PlanPeriod>("current");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/plans", { cache: "no-store" });
      if (res.status === 401) {
        router.replace("/login?next=/plans");
        return;
      }
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "โหลดข้อมูลไม่สำเร็จ");
        return;
      }
      setPlans(data.plans as Plan[]);
      setMilestones((data.milestones ?? []) as Milestone[]);
      announceDue((data.milestones ?? []) as Milestone[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  // A shortcut (e.g. from the home dashboard) can deep-link straight into the
  // add form via ?new=1 (opened via the lazy state init above); strip the
  // param afterwards so a refresh doesn't reopen it.
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      router.replace("/plans");
    }
  }, [searchParams, router]);

  const milestonesByPlan = useMemo(() => {
    const map = new Map<string, Milestone[]>();
    for (const m of milestones) map.set(m.plan_id, [...(map.get(m.plan_id) ?? []), m]);
    return map;
  }, [milestones]);

  // A plan is "ours" when we created it; otherwise we only see it because we
  // were invited — those are read-mostly, so we hide the Edit/Delete actions.
  const me = userEmail.trim().toLowerCase();
  const isOwner = (p: Plan) => p.created_by.trim().toLowerCase() === me;

  // Plans split into Current vs Past: anything finished/archived, or whose
  // overall due date has already gone by (Asia/Bangkok), counts as Past.
  const visiblePlans = useMemo(() => {
    const today = bangkokDateStr();
    const isPast = (p: Plan) => {
      if (p.status !== "active") return true;
      if (!p.due_date) return false;
      const d = Date.parse(p.due_date);
      return !Number.isNaN(d) && bangkokDateStr(new Date(d)) < today;
    };
    return plans.filter((p) => {
      if (scope === "me" && p.created_by.trim().toLowerCase() !== me) return false;
      if (scope === "invited" && p.created_by.trim().toLowerCase() === me) return false;
      if (period === "current" && isPast(p)) return false;
      if (period === "past" && !isPast(p)) return false;
      return true;
    });
  }, [plans, scope, period, me]);

  const selected = plans.find((p) => p.id === selectedId) ?? null;

  function upsertMilestone(m: Milestone) {
    setMilestones((prev) => {
      const i = prev.findIndex((x) => x.id === m.id);
      if (i === -1) return [...prev, m];
      const next = [...prev];
      next[i] = m;
      return next;
    });
  }
  function removeMilestone(id: string) {
    setMilestones((prev) => prev.filter((m) => m.id !== id));
  }
  function upsertPlan(p: Plan) {
    setPlans((prev) => {
      const i = prev.findIndex((x) => x.id === p.id);
      if (i === -1) return [...prev, p];
      const next = [...prev];
      next[i] = p;
      return next;
    });
  }

  async function savePlan(payload: PlanPayload, id: string | null) {
    setBusy(true);
      showLoading(id ? "กำลังบันทึกแผน…" : "กำลังสร้างแผน…");
    try {
      const res = await fetch(id ? `/api/plans/${id}` : "/api/plans", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
          showError(data.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      upsertPlan(data.plan as Plan);
      setShowPlanForm(false);
      setEditingPlan(null);
        showSuccess(id ? "บันทึกแผนแล้ว" : "สร้างแผนแล้ว");
    } catch (e) {
        showError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function deletePlan(p: Plan) {
    const c = await Swal.fire({
        title: "ลบแผนนี้?",
        text: "แผนและ milestone ทั้งหมดจะถูกซ่อนจากรายการและปฏิทินของคุณ",
      icon: "warning",
      showCancelButton: true,
        confirmButtonText: "ลบ",
      confirmButtonColor: "#dc2626",
    });
    if (!c.isConfirmed) return;
      showLoading("กำลังลบ…");
    try {
      const res = await fetch(`/api/plans/${p.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
          showError(data.error ?? "ลบไม่สำเร็จ");
        return;
      }
      setPlans((prev) => prev.filter((x) => x.id !== p.id));
      setMilestones((prev) => prev.filter((m) => m.plan_id !== p.id));
      if (selectedId === p.id) setSelectedId(null);
        showSuccess("ลบแผนแล้ว");
    } catch (e) {
        showError(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    }
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-y-auto p-4">
      {!selected && (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-black/10 pb-3 dark:border-white/10">
          <h1 className="text-lg font-semibold">แผน &amp; ไทม์ไลน์</h1>
          <button
            onClick={() => {
              setEditingPlan(null);
              setShowPlanForm(true);
            }}
            className="rounded-lg bg-pink-600 px-3 py-1.5 text-sm font-medium text-white"
          >
            + แผนใหม่
          </button>
        </header>
      )}

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      {showPlanForm && !selected && (
        <div className="mb-4 rounded-xl border border-black/10 p-4 dark:border-white/15">
          <PlanForm
            key={editingPlan?.id ?? "new"}
            initial={editingPlan}
            busy={busy}
            onSave={savePlan}
            onCancel={() => {
              setShowPlanForm(false);
              setEditingPlan(null);
            }}
          />
        </div>
      )}

      {loading ? (
        <p className="py-8 text-center text-sm opacity-60">กำลังโหลด…</p>
      ) : selected ? (
        <TimelineView
          plan={selected}
          isOwner={isOwner(selected)}
          milestones={milestonesByPlan.get(selected.id) ?? []}
          onBack={() => setSelectedId(null)}
          onMilestoneUpsert={upsertMilestone}
          onMilestoneRemove={removeMilestone}
          onEditPlan={() => {
            setEditingPlan(selected);
            setSelectedId(null);
            setShowPlanForm(true);
          }}
        />
      ) : plans.length === 0 ? (
        <p className="py-8 text-center text-sm opacity-60">
          ยังไม่มีแผน สร้างแผนหนึ่ง (เช่น “อ่านหนังสือ X”) แล้วเพิ่ม milestone พร้อมกำหนดวันที่
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Segmented
              value={scope}
              onChange={setScope}
              options={[
                { value: "me", label: "ของฉัน" },
                { value: "invited", label: "ถูกเชิญ" },
                { value: "all", label: "ทั้งหมด" },
              ]}
            />
            <span className="opacity-30">·</span>
            <Segmented
              value={period}
              onChange={setPeriod}
              options={[
                { value: "current", label: "ปัจจุบัน" },
                { value: "past", label: "ผ่านมาแล้ว" },
                { value: "all", label: "ทั้งหมด" },
              ]}
            />
          </div>
          {visiblePlans.length === 0 ? (
            <p className="py-8 text-center text-sm opacity-60">ไม่มีแผนตรงกับตัวกรองนี้</p>
          ) : (
            <ul className="space-y-2">
              {visiblePlans.map((p) => {
            const ms = milestonesByPlan.get(p.id) ?? [];
            const counts = summarize(ms);
            return (
              <li
                key={p.id}
                className="rounded-xl border border-black/10 p-3 dark:border-white/15"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <button onClick={() => setSelectedId(p.id)} className="text-left">
                      <span className="font-medium">{p.title}</span>
                      {!isOwner(p) && (
                        <span
                          className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                          title={p.created_by ? `เชิญโดย ${p.created_by}` : "แชร์ให้คุณ"}
                        >
                          ถูกเชิญ
                        </span>
                      )}
                      {p.status !== "active" && (
                        <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-xs dark:bg-white/15">
                          {p.status === "done" ? "เสร็จแล้ว" : p.status === "archived" ? "เก็บถาวร" : p.status}
                        </span>
                      )}
                    </button>
                    {p.description && (
                      <CollapsibleText text={p.description} className="text-sm opacity-70" lines={3} />
                    )}
                    {p.due_date && (
                      <p className="text-xs opacity-60">🎯 กำหนด {formatBangkok(p.due_date)}</p>
                    )}
                    <p className="mt-1 text-xs opacity-60">
                      {ms.length} milestone
                      {counts.done > 0 && ` · เสร็จแล้ว ${counts.done}`}
                      {counts.overdue > 0 && (
                        <span className="text-red-600"> · ⚠️ เลยกำหนด {counts.overdue}</span>
                      )}
                      {counts.today > 0 && (
                        <span className="text-amber-600"> · 🔔 ครบกำหนดวันนี้ {counts.today}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => setSelectedId(p.id)} className={btnGhost}>
                      เปิด
                    </button>
                    {isOwner(p) && (
                      <>
                        <button
                          onClick={() => {
                            setEditingPlan(p);
                            setShowPlanForm(true);
                          }}
                          className={btnGhost}
                        >
                          แก้ไข
                        </button>
                        <button onClick={() => deletePlan(p)} className={btnGhost}>
                          ลบ
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

const btnGhost = "rounded-lg border border-black/15 dark:border-white/25 px-2.5 py-1 text-xs";

function summarize(ms: Milestone[]): { done: number; overdue: number; today: number } {
  let done = 0;
  let overdue = 0;
  let today = 0;
  const todayStr = bangkokDateStr();
  for (const m of ms) {
    if (m.status === "done") {
      done += 1;
      continue;
    }
    if (isTodayBangkok(m.due_date)) today += 1;
    else {
      const d = Date.parse(m.due_date);
      if (!Number.isNaN(d) && bangkokDateStr(new Date(d)) < todayStr) overdue += 1;
    }
  }
  return { done, overdue, today };
}

// On load, surface a single in-app toast if anything is overdue or due today.
function announceDue(ms: Milestone[]) {
  const { overdue, today } = summarize(ms);
  if (overdue === 0 && today === 0) return;
  const parts: string[] = [];
  if (overdue) parts.push(`เลยกำหนด ${overdue}`);
  if (today) parts.push(`ครบกำหนดวันนี้ ${today}`);
  Swal.fire({
    toast: true,
    position: "top-end",
    icon: overdue ? "warning" : "info",
    title: parts.join(" · "),
    showConfirmButton: false,
    timer: 4000,
    timerProgressBar: true,
  });
}

// ---- inline plan create/edit form ------------------------------------------
function PlanForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: Plan | null;
  busy: boolean;
  onSave: (payload: PlanPayload, id: string | null) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [localDue, setLocalDue] = useState(initial?.due_date ? isoToLocalInput(initial.due_date) : "");
  const [inviteesRaw, setInviteesRaw] = useState((initial?.invitees ?? []).join(", "));
  const [error, setError] = useState("");

  const inputCls =
    "w-full rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 outline-none focus:border-pink-500";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("กรุณากรอกชื่อแผน");
    // The server normalizes/validates emails; split loosely here, but reject
    // non-gmail addresses up front so they aren't silently dropped on save.
    const invitees = inviteesRaw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    const badEmail = invitees.find((e) => !isGmail(e));
    if (badEmail) return setError(`"${badEmail}" ต้องเป็นอีเมล @gmail.com — การเข้าสู่ระบบใช้ Google`);
    onSave(
      {
        title: title.trim(),
        description,
        invitees,
        due_date: localDue ? localInputToISO(localDue) : "",
      },
      initial?.id ?? null,
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <h2 className="text-lg font-semibold">{initial ? "แก้ไขแผน" : "แผนใหม่"}</h2>
      <label className="block text-sm">
        <span className="opacity-70">ชื่อแผน (เช่น “อ่านหนังสือ X”)</span>
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="block text-sm">
        <span className="opacity-70">รายละเอียด (ไม่บังคับ)</span>
        <textarea className={inputCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="block text-sm">
        <span className="opacity-70">กำหนดวันเสร็จโดยรวม (Asia/Bangkok — ไม่บังคับ)</span>
        <DateTimePicker value={localDue} onChange={setLocalDue} />
        <span className="mt-1 block text-xs opacity-60">
          Milestone จะกำหนดวันเกินวันนี้ไม่ได้
        </span>
      </label>
      <label className="block text-sm">
        <span className="opacity-70">แชร์ให้ (อีเมล คั่นด้วยจุลภาค — ไม่บังคับ)</span>
        <input
          className={inputCls}
          value={inviteesRaw}
          onChange={(e) => setInviteesRaw(e.target.value)}
          placeholder="name@gmail.com, friend@gmail.com"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-pink-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {busy ? "กำลังบันทึก…" : initial ? "บันทึกการเปลี่ยนแปลง" : "สร้างแผน"}
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
