"use client";

// Enable/disable browser notifications for the signed-in user. Drop this
// anywhere in the authenticated UI (e.g. a settings panel or the timeline
// header). Renders nothing intrusive when push is unsupported or blocked.
import { usePushNotifications } from "@/hooks/usePushNotifications";

export default function PushToggle() {
  const { permission, isSubscribed, loading, error, subscribe, unsubscribe } =
    usePushNotifications();

  if (permission === "unsupported") {
    return (
      <p className="text-xs opacity-60">
        Notifications aren&apos;t supported in this browser.
      </p>
    );
  }

  if (permission === "denied") {
    return (
      <p className="text-xs opacity-60">
        Notifications are blocked — enable them in your browser&apos;s site settings.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={isSubscribed ? unsubscribe : subscribe}
        disabled={loading}
        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
          isSubscribed
            ? "border border-black/15 opacity-70 hover:opacity-100 dark:border-white/20"
            : "bg-pink-600 text-white hover:bg-pink-700"
        }`}
      >
        {loading ? "…" : isSubscribed ? "🔕 Disable notifications" : "🔔 Enable notifications"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
