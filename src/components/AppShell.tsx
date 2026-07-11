"use client";

// App chrome shared by every authenticated page: a left sidebar (brand, nav,
// notification controls, calendar links, and log out) plus the page content on
// the right. On small screens the sidebar collapses into a slide-over drawer.
// Wrap a page's view with <AppShell userEmail feedToken>…</AppShell>.
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { showLoading, showSuccess, showError } from "@/lib/swal";
import BuildInfo from "./BuildInfo";
import PushToggle from "./PushToggle";

const NAV = [
  { href: "/", label: "หน้าหลัก", icon: "🏠" },
  { href: "/spots", label: "สถานที่ & แผนที่", icon: "📍" },
  { href: "/plans", label: "แผน & ไทม์ไลน์", icon: "🗓️" },
];

export default function AppShell({
  userEmail,
  feedToken,
  children,
}: {
  userEmail: string;
  feedToken: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false); // mobile drawer

  async function logout() {
    showLoading("กำลังออกจากระบบ…");
    try {
      await fetch("/api/auth", { method: "DELETE" });
      // Hard navigation: a full page load tears down the Swal overlay and all
      // client-side state, so the "logging out" modal can't stick around.
      window.location.replace("/login");
    } catch (e) {
      showError(e instanceof Error ? e.message : "ออกจากระบบไม่สำเร็จ");
    }
  }

  const sidebar = (
    <div className="flex h-full w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <div>
        <Link href="/" className="text-base font-semibold">
          💕 Date Spot Planner
        </Link>
        <BuildInfo />
      </div>

      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                active
                  ? "bg-pink-600 font-medium text-white"
                  : "opacity-75 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
              }`}
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <section className="space-y-1.5">
        <h2 className="px-1 text-xs font-medium uppercase tracking-wide opacity-50">
          การแจ้งเตือน
        </h2>
        <PushToggle />
      </section>

      <section className="space-y-1.5">
        <h2 className="px-1 text-xs font-medium uppercase tracking-wide opacity-50">
          ปฏิทิน
        </h2>
        <CopyLink label="คัดลอกลิงก์ปฏิทิน (สถานที่)" path="/api/calendar.ics" token={feedToken} />
        <CopyLink label="คัดลอกลิงก์ปฏิทิน (แผน)" path="/api/plans.ics" token={feedToken} />
      </section>

      <div className="mt-auto space-y-2 border-t border-black/10 pt-3 dark:border-white/10">
        {userEmail && (
          <p className="truncate px-1 text-xs opacity-60" title={userEmail}>
            {userEmail}
          </p>
        )}
        <button
          onClick={logout}
          className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm opacity-80 transition hover:bg-black/5 hover:opacity-100 dark:border-white/20 dark:hover:bg-white/10"
        >
          ออกจากระบบ
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Desktop: pinned sidebar */}
      <aside className="hidden sm:block">{sidebar}</aside>

      {/* Mobile: slide-over drawer */}
      {open && (
        <div className="fixed inset-0 z-40 sm:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 shadow-xl">{sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar with the drawer toggle */}
        <div className="flex shrink-0 items-center gap-2 border-b border-black/10 px-3 py-2 sm:hidden dark:border-white/10">
          <button
            onClick={() => setOpen(true)}
            aria-label="เปิดเมนู"
            className="rounded-lg px-2 py-1 text-lg hover:bg-black/5 dark:hover:bg-white/10"
          >
            ☰
          </button>
          <span className="text-sm font-semibold">Date Spot Planner</span>
        </div>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

// A one-click "copy this calendar feed URL" button. The absolute URL is built
// at click time (window.origin is unavailable during SSR).
function CopyLink({ label, path, token }: { label: string; path: string; token: string }) {
  const [copied, setCopied] = useState(false);
  if (!token) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}?token=${token}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      showSuccess("คัดลอกลิงก์ปฏิทินแล้ว");
    } catch {
      /* clipboard may be blocked; ignore */
    }
  }

  return (
    <button
      onClick={copy}
      className="w-full rounded-lg border border-black/15 px-3 py-1.5 text-left text-xs opacity-80 transition hover:opacity-100 dark:border-white/20"
    >
      {copied ? "คัดลอกแล้ว!" : label}
    </button>
  );
}
