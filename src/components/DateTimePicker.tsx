"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

const pad = (n: number) => String(n).padStart(2, "0");

// "00:00" .. "23:30" in 30-minute steps — click-only, no typing.
const TIME_SLOTS: string[] = [];
for (let h = 0; h < 24; h++) for (const m of [0, 30]) TIME_SLOTS.push(`${pad(h)}:${pad(m)}`);

function fmt12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${ap}`;
}

// "YYYY-MM-DD" -> "Mon, 23 Mar 2026". Uses local-component Date purely as a
// (Y,M,D) container — no UTC/ISO conversion, so it is timezone-neutral.
function fmtDate(d: string): string {
  const [y, mo, da] = d.split("-").map(Number);
  const dow = new Date(y, mo - 1, da).getDay();
  return `${WEEKDAYS[dow]}, ${da} ${MONTHS[mo - 1].slice(0, 3)} ${y}`;
}

export default function DateTimePicker({
  value,
  onChange,
  className = "",
}: {
  value: string; // "YYYY-MM-DDTHH:mm" or ""
  onChange: (v: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timeListRef = useRef<HTMLDivElement>(null);

  const datePart = value.slice(0, 10);
  const timePart = value.slice(11, 16);

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const [view, setView] = useState(() => {
    const base = datePart || todayStr;
    const [y, m] = base.split("-").map(Number);
    return { y, m: m - 1 }; // m: 0-based
  });

  // Include an off-grid existing time (e.g. 18:45 from an extracted spot).
  const slots = useMemo(() => {
    if (timePart && !TIME_SLOTS.includes(timePart)) {
      return [...TIME_SLOTS, timePart].sort();
    }
    return TIME_SLOTS;
  }, [timePart]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Scroll the selected time into view when the popover opens.
  useEffect(() => {
    if (open && timeListRef.current) {
      const el = timeListRef.current.querySelector<HTMLElement>('[data-selected="true"]');
      el?.scrollIntoView({ block: "center" });
    }
  }, [open]);

  function pickDay(d: number) {
    const ds = `${view.y}-${pad(view.m + 1)}-${pad(d)}`;
    onChange(`${ds}T${timePart || "19:00"}`);
  }

  function pickTime(t: string) {
    onChange(`${datePart || todayStr}T${t}`);
  }

  function shiftMonth(delta: number) {
    setView((v) => {
      const m = v.m + delta;
      return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });
  }

  const firstDow = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const triggerCls =
    "w-full rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-left outline-none focus:border-pink-500";

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className={triggerCls}>
        {value ? (
          <span>
            {fmtDate(datePart)} · {fmt12(timePart)}
          </span>
        ) : (
          <span className="opacity-50">Pick a date &amp; time</span>
        )}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 flex w-max max-w-[92vw] gap-3 rounded-xl border border-black/15 bg-white p-3 shadow-xl dark:border-white/20 dark:bg-zinc-900">
          {/* Calendar */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                className="rounded-md px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
                aria-label="เดือนก่อนหน้า"
              >
                ‹
              </button>
              <div className="text-sm font-medium">
                {MONTHS[view.m]} {view.y}
              </div>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                className="rounded-md px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
                aria-label="เดือนถัดไป"
              >
                ›
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-xs">
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-1 opacity-50">
                  {w}
                </div>
              ))}
              {cells.map((d, i) => {
                if (d === null) return <div key={i} />;
                const ds = `${view.y}-${pad(view.m + 1)}-${pad(d)}`;
                const selected = ds === datePart;
                const isToday = ds === todayStr;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pickDay(d)}
                    className={[
                      "h-8 w-8 rounded-full text-sm",
                      selected
                        ? "bg-pink-600 text-white"
                        : "hover:bg-black/5 dark:hover:bg-white/10",
                      isToday && !selected ? "ring-1 ring-pink-500" : "",
                    ].join(" ")}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time list */}
          <div ref={timeListRef} className="h-[268px] w-24 overflow-y-auto pr-1">
            <div className="grid gap-1">
              {slots.map((t) => {
                const selected = t === timePart;
                return (
                  <button
                    key={t}
                    type="button"
                    data-selected={selected}
                    onClick={() => pickTime(t)}
                    className={[
                      "rounded-md px-2 py-1.5 text-sm",
                      selected
                        ? "bg-pink-600 text-white"
                        : "hover:bg-black/5 dark:hover:bg-white/10",
                    ].join(" ")}
                  >
                    {fmt12(t)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
