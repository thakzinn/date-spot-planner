"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Place } from "@/lib/places";
import type { Milestone, Plan } from "@/lib/plans";
import { formatBangkok } from "@/lib/format";
import { bangkokDateStr, nowBangkokISO } from "@/lib/dates";

// The home page is a read-only dashboard: a rollup of where our date spots stand
// by status and how many plans are still open, each anchored by the single
// nearest thing coming up. Managing spots lives on /spots, plans on /plans.
// Global chrome (nav, notifications, log out, calendar links) lives in AppShell.
export default function HomeView() {
  const router = useRouter();
  const [places, setPlaces] = useState<Place[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [placesRes, plansRes] = await Promise.all([
        fetch("/api/places", { cache: "no-store" }),
        fetch("/api/plans", { cache: "no-store" }),
      ]);
      if (placesRes.status === 401 || plansRes.status === 401) {
        router.replace("/login");
        return;
      }
      const placesData = await placesRes.json();
      if (placesData.ok) setPlaces(placesData.places as Place[]);
      else setError(placesData.error ?? "โหลดข้อมูลไม่สำเร็จ");

      // Plan stats are best-effort — a plans failure must not blank the spots half.
      const plansData = await plansRes.json().catch(() => null);
      if (plansData?.ok) {
        setPlans(plansData.plans as Plan[]);
        setMilestones((plansData.milestones ?? []) as Milestone[]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  // Rollup over everything we can see. "Upcoming" spots/pending milestones are
  // today-or-future; ones whose date already slipped are counted as overdue.
  const stats = useMemo(() => {
    const today = bangkokDateStr();
    const nowMs = Date.parse(nowBangkokISO());

    let upcoming = 0;
    let dueToday = 0;
    let overdueSpots = 0;
    let visited = 0;
    let nextSpot: Place | null = null;
    for (const p of places) {
      if (p.status === "visited") {
        visited += 1;
        continue;
      }
      if (p.status === "cancelled") continue;
      const t = Date.parse(p.planned_date);
      const day = Number.isNaN(t) ? "" : bangkokDateStr(new Date(t));
      if (day && day < today) {
        overdueSpots += 1;
        continue;
      }
      upcoming += 1;
      if (day === today) dueToday += 1;
      if (!Number.isNaN(t) && t >= nowMs && (!nextSpot || Date.parse(nextSpot.planned_date) > t)) {
        nextSpot = p;
      }
    }

    const planTitle = new Map(plans.map((p) => [p.id, p.title]));
    const activePlans = plans.filter((p) => p.status === "active").length;
    let pendingMs = 0;
    let overdueMs = 0;
    let nextMs: Milestone | null = null;
    for (const m of milestones) {
      if (m.status === "done") continue;
      pendingMs += 1;
      const t = Date.parse(m.due_date);
      if (!Number.isNaN(t) && bangkokDateStr(new Date(t)) < today) overdueMs += 1;
      if (!Number.isNaN(t) && t >= nowMs && (!nextMs || Date.parse(nextMs.due_date) > t)) {
        nextMs = m;
      }
    }

    return {
      upcoming,
      dueToday,
      overdueSpots,
      visited,
      nextSpot,
      activePlans,
      pendingMs,
      overdueMs,
      nextMs,
      nextMsPlan: nextMs ? planTitle.get(nextMs.plan_id) ?? "" : "",
    };
  }, [places, plans, milestones]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">หน้าหลัก</h1>
          {/* Shortcuts to the two most common actions — skips the extra click
              of navigating to a section first, then pressing its add button. */}
          <div className="flex gap-2">
            <Link
              href="/spots?new=1"
              className="rounded-lg bg-pink-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              + เพิ่มสถานที่
            </Link>
            <Link
              href="/plans?new=1"
              className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-medium dark:border-white/25"
            >
              + แผนใหม่
            </Link>
          </div>
        </div>
          {error && <p className="text-sm text-red-600">{error}</p>}

          {/* Date spots */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Date spots</h2>
              <Link href="/spots" className="text-sm underline opacity-70">
                จัดการ / ดูแผนที่ ›
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatCard
                label="ที่ต้องไป"
                loading={loading}
                value={stats.upcoming}
                accent="text-pink-600 dark:text-pink-400"
                sub={
                  [
                    stats.dueToday > 0 ? `วันนี้ ${stats.dueToday}` : "",
                    stats.overdueSpots > 0 ? `เลยกำหนด ${stats.overdueSpots}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ") || "planned"
                }
                subAlert={stats.overdueSpots > 0}
              />
              <StatCard label="ไปแล้ว" loading={loading} value={stats.visited} sub="visited" />
              <NextCard
                title="ที่ใกล้ถึง"
                href="/spots"
                name={stats.nextSpot?.place_name ?? null}
                meta={stats.nextSpot ? formatBangkok(stats.nextSpot.planned_date) : ""}
                due={stats.nextSpot?.planned_date ?? ""}
                empty={loading ? "กำลังโหลดข้อมูล…" : "ไม่มีนัดที่ค้าง 🎉"}
              />
            </div>
          </section>

          {/* Plans */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Plans</h2>
              <Link href="/plans" className="text-sm underline opacity-70">
                ดูไทม์ไลน์ ›
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatCard
                label="แผนที่ต้องทำ"
                loading={loading}
                value={stats.activePlans}
                accent="text-pink-600 dark:text-pink-400"
                sub={
                  [
                    stats.pendingMs > 0 ? `${stats.pendingMs} งานค้าง` : "",
                    stats.overdueMs > 0 ? `เลยกำหนด ${stats.overdueMs}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ") || "active"
                }
                subAlert={stats.overdueMs > 0}
              />
              <NextCard
                title="งานที่ใกล้ถึง"
                href="/plans"
                name={stats.nextMs?.title ?? null}
                meta={stats.nextMsPlan ? `📋 ${stats.nextMsPlan}` : ""}
                due={stats.nextMs?.due_date ?? ""}
                empty={loading ? "กำลังโหลดข้อมูล…" : "ไม่มีงานค้าง 🎉"}
                className="col-span-2 sm:col-span-2"
              />
            </div>
          </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  sub,
  subAlert,
  loading,
}: {
  label: string;
  value: number;
  accent?: string;
  sub?: string;
  subAlert?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-black/10 px-4 py-3 dark:border-white/15">
      <div className="text-xs opacity-60">{label}</div>
      {loading ? (
        <div className="mt-1.5 h-7 w-10 animate-pulse rounded bg-black/10 dark:bg-white/15" />
      ) : (
        <div className={`text-3xl font-semibold tabular-nums ${accent ?? ""}`}>{value}</div>
      )}
      {sub && (
        <div className={`text-[11px] ${subAlert ? "text-red-600" : "opacity-60"}`}>
          {loading ? "กำลังโหลดข้อมูล…" : sub}
        </div>
      )}
    </div>
  );
}

// The "next up" highlight — always a link to the page where that item lives.
function NextCard({
  title,
  href,
  name,
  meta,
  due,
  empty,
  className,
}: {
  title: string;
  href: string;
  name: string | null;
  meta: string;
  due: string;
  empty: string;
  className?: string;
}) {
  const base =
    "rounded-xl border px-4 py-3 " +
    (name
      ? "border-pink-300/70 bg-pink-50/60 dark:border-pink-400/30 dark:bg-pink-900/20"
      : "border-black/10 dark:border-white/15");
  return (
    <Link href={href} className={`block ${base} ${className ?? ""}`}>
      <div className="text-xs opacity-60">{title}</div>
      {name ? (
        <>
          <div className="truncate text-sm font-medium">{name}</div>
          {meta && <div className="truncate text-[11px] opacity-60">{meta}</div>}
          {due && <Countdown due={due} />}
        </>
      ) : (
        <div className="mt-1 text-sm opacity-60">{empty}</div>
      )}
    </Link>
  );
}

// Live "อีก N วัน HH:MM:SS" countdown that flips red once the date passes.
function Countdown({ due }: { due: string }) {
  const target = Date.parse(due);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (Number.isNaN(target)) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  if (Number.isNaN(target)) return null;

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
    <span className={`text-xs tabular-nums ${overdue ? "text-red-600" : "text-pink-600 dark:text-pink-400"}`}>
      {overdue ? `เลยมา ${dayPart}${clock}` : `อีก ${dayPart}${clock}`}
    </span>
  );
}
