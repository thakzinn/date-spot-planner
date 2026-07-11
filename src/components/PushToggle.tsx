"use client";

// Browser-notification controls for the signed-in user. Lives in the sidebar so
// it's reachable on every page. Enable/disable a subscription, and once enabled,
// fire a test notification via /api/push/test.
import { useState } from "react";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { showSuccess, showError } from "@/lib/swal";

export default function PushToggle() {
  const { permission, isSubscribed, loading, error, subscribe, unsubscribe } =
    usePushNotifications();
  const [testing, setTesting] = useState(false);

  async function sendTest() {
    setTesting(true);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        showSuccess("ส่งการแจ้งเตือนทดสอบแล้ว");
      } else if (res.status === 409) {
        showError("ยังไม่ได้เปิดการแจ้งเตือนบนอุปกรณ์นี้");
      } else {
        showError(data.error ?? "ส่งไม่สำเร็จ");
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : "ส่งไม่สำเร็จ");
    } finally {
      setTesting(false);
    }
  }

  if (permission === "unsupported") {
    return <p className="text-xs opacity-60">เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน</p>;
  }

  if (permission === "denied") {
    return (
      <p className="text-xs opacity-60">
        การแจ้งเตือนถูกบล็อก — เปิดใน &ldquo;การตั้งค่าเว็บไซต์&rdquo; ของเบราว์เซอร์
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {!isSubscribed ? (
        <button
          onClick={subscribe}
          disabled={loading}
          className="w-full rounded-lg bg-pink-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-pink-700 disabled:opacity-50"
        >
          {loading ? "กำลังเปิด…" : "🔔 เปิดการแจ้งเตือน"}
        </button>
      ) : (
        <div className="flex gap-1.5">
          <button
            onClick={sendTest}
            disabled={testing || loading}
            className="flex-1 rounded-lg bg-pink-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-pink-700 disabled:opacity-50"
          >
            {testing ? "กำลังส่ง…" : "ส่งทดสอบ"}
          </button>
          <button
            onClick={unsubscribe}
            disabled={loading}
            title="ปิดการแจ้งเตือน"
            className="rounded-lg border border-black/15 px-2.5 py-1.5 text-sm opacity-70 transition hover:opacity-100 disabled:opacity-50 dark:border-white/20"
          >
            🔕
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
