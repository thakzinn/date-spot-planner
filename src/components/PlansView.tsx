"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Swal, showLoading, showSuccess, showError } from "@/lib/swal";
import { isGmail, type Milestone, type Plan } from "@/lib/plans";
import { bangkokDateStr, isTodayBangkok } from "@/lib/dates";
import { formatBangkok, isoToLocalInput, localInputToISO } from "@/lib/format";
import DateTimePicker from "./DateTimePicker";
import TimelineView from "./TimelineView";
import Segmented from "./Segmented";

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
  feedToken,
}: {
  userEmail: string;
  userName?: string;
  feedToken?: string;
}) {
  const router = useRouter();
  const [feedUrl, setFeedUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPlanForm, setShowPlanForm] = useState(false);
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
        setError(data.error ?? "Failed to load");
        return;
      }
      setPlans(data.plans as Plan[]);
      setMilestones((data.milestones ?? []) as Milestone[]);
      announceDue((data.milestones ?? []) as Milestone[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  // Build the feed URL after mount — window.origin isn't available during SSR,
  // and branching on it during render would cause a hydration mismatch.
  useEffect(() => {
    if (feedToken) {
      setFeedUrl(`${window.location.origin}/api/plans.ics?token=${feedToken}`);
    }
  }, [feedToken]);

  async function copyFeed() {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      showSuccess("Plans calendar URL copied");
    } catch {
      /* clipboard may be blocked; ignore */
    }
  }

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
    showLoading(id ? "Saving plan…" : "Creating plan…");
    try {
      const res = await fetch(id ? `/api/plans/${id}` : "/api/plans", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showError(data.error ?? "Save failed");
        return;
      }
      upsertPlan(data.plan as Plan);
      setShowPlanForm(false);
      setEditingPlan(null);
      showSuccess(id ? "Plan saved" : "Plan created");
    } catch (e) {
      showError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function deletePlan(p: Plan) {
    const c = await Swal.fire({
      title: "Delete this plan?",
      text: "The plan and all its milestones will be hidden from your list and calendar.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete",
      confirmButtonColor: "#dc2626",
    });
    if (!c.isConfirmed) return;
    showLoading("Deleting…");
    try {
      const res = await fetch(`/api/plans/${p.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showError(data.error ?? "Delete failed");
        return;
      }
      setPlans((prev) => prev.filter((x) => x.id !== p.id));
      setMilestones((prev) => prev.filter((m) => m.plan_id !== p.id));
      if (selectedId === p.id) setSelectedId(null);
      showSuccess("Plan deleted");
    } catch (e) {
      showError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col p-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-black/10 pb-3 dark:border-white/10">
        <div>
          <h1 className="text-lg font-semibold">Plans &amp; Timeline</h1>
          <Link href="/" className="text-sm underline opacity-70">
            ‹ Date spots
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {!selected && (
            <button
              onClick={() => {
                setEditingPlan(null);
                setShowPlanForm(true);
              }}
              className="rounded-lg bg-pink-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              + New plan
            </button>
          )}
          {feedUrl && (
            <button
              onClick={copyFeed}
              title={feedUrl}
              className="rounded-lg border border-black/15 dark:border-white/25 px-3 py-1.5 text-sm"
            >
              {copied ? "Copied!" : "Copy plans calendar URL"}
            </button>
          )}
          <span className="hidden text-xs opacity-60 sm:inline" title={userEmail}>
            {userEmail}
          </span>
        </div>
      </header>

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
        <p className="py-8 text-center text-sm opacity-60">Loading…</p>
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
          No plans yet. Create one (e.g. “อ่านหนังสือ X”) and add milestones with due dates.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Segmented
              value={scope}
              onChange={setScope}
              options={[
                { value: "me", label: "Me" },
                { value: "invited", label: "Invited" },
                { value: "all", label: "All" },
              ]}
            />
            <span className="opacity-30">·</span>
            <Segmented
              value={period}
              onChange={setPeriod}
              options={[
                { value: "current", label: "Current" },
                { value: "past", label: "Past" },
                { value: "all", label: "All" },
              ]}
            />
          </div>
          {visiblePlans.length === 0 ? (
            <p className="py-8 text-center text-sm opacity-60">No plans match this filter.</p>
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
                  <button onClick={() => setSelectedId(p.id)} className="text-left">
                    <span className="font-medium">{p.title}</span>
                    {!isOwner(p) && (
                      <span
                        className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                        title={p.created_by ? `Invited by ${p.created_by}` : "Shared with you"}
                      >
                        invited
                      </span>
                    )}
                    {p.status !== "active" && (
                      <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-xs dark:bg-white/15">
                        {p.status}
                      </span>
                    )}
                    {p.description && <p className="text-sm opacity-70">{p.description}</p>}
                    {p.due_date && (
                      <p className="text-xs opacity-60">🎯 due {formatBangkok(p.due_date)}</p>
                    )}
                    <p className="mt-1 text-xs opacity-60">
                      {ms.length} milestone{ms.length === 1 ? "" : "s"}
                      {counts.done > 0 && ` · ${counts.done} done`}
                      {counts.overdue > 0 && (
                        <span className="text-red-600"> · ⚠️ {counts.overdue} overdue</span>
                      )}
                      {counts.today > 0 && (
                        <span className="text-amber-600"> · 🔔 {counts.today} due today</span>
                      )}
                    </p>
                  </button>
                  <div className="flex gap-1.5">
                    <button onClick={() => setSelectedId(p.id)} className={btnGhost}>
                      Open
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
                          Edit
                        </button>
                        <button onClick={() => deletePlan(p)} className={btnGhost}>
                          Delete
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
  if (overdue) parts.push(`${overdue} overdue`);
  if (today) parts.push(`${today} due today`);
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
    if (!title.trim()) return setError("Title is required.");
    // The server normalizes/validates emails; split loosely here, but reject
    // non-gmail addresses up front so they aren't silently dropped on save.
    const invitees = inviteesRaw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    const badEmail = invitees.find((e) => !isGmail(e));
    if (badEmail) return setError(`"${badEmail}" must be a @gmail.com address — sign-in uses Google.`);
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
      <h2 className="text-lg font-semibold">{initial ? "Edit plan" : "New plan"}</h2>
      <label className="block text-sm">
        <span className="opacity-70">Title (e.g. “อ่านหนังสือ X”)</span>
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="block text-sm">
        <span className="opacity-70">Description (optional)</span>
        <textarea className={inputCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="block text-sm">
        <span className="opacity-70">Overall due date (Asia/Bangkok — optional)</span>
        <DateTimePicker value={localDue} onChange={setLocalDue} />
        <span className="mt-1 block text-xs opacity-60">
          Milestones can&apos;t be scheduled after this date.
        </span>
      </label>
      <label className="block text-sm">
        <span className="opacity-70">Share with (emails, comma-separated — optional)</span>
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
          {busy ? "Saving…" : initial ? "Save changes" : "Create plan"}
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
