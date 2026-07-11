"use client";

// Client hook for browser push: registers the service worker, requests
// permission, subscribes via PushManager, and syncs the subscription with the
// server (/api/push). Reflects existing state on mount so a returning user sees
// the right button. Safe to call in any client component — it no-ops when the
// browser lacks Notification/PushManager support (e.g. iOS Safari without an
// installed PWA).
import { useCallback, useEffect, useState } from "react";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

// applicationServerKey must be a raw Uint8Array, so decode the base64url key.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // Back the array with an explicit ArrayBuffer so its type is
  // Uint8Array<ArrayBuffer>, which is what applicationServerKey requires.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export type PushPermission = "unsupported" | "default" | "denied" | "granted";

export interface UsePushNotifications {
  permission: PushPermission;
  isSubscribed: boolean;
  loading: boolean;
  error: string | null;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

export function usePushNotifications(): UsePushNotifications {
  const [permission, setPermission] = useState<PushPermission>("default");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  // Reflect current permission + any existing subscription on mount. All state
  // updates happen inside the async IIFE (not synchronously in the effect body)
  // so they don't trigger cascading renders.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supported) {
        if (!cancelled) setPermission("unsupported");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (cancelled) return;
        setPermission(Notification.permission as PushPermission);
        setSubscription(sub);
      } catch {
        /* ignore — leaves the default state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported]);

  const subscribe = useCallback(async () => {
    if (!supported) return;
    if (!VAPID_PUBLIC_KEY) {
      setError("NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // 1. Register the service worker (idempotent).
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;

      // 2. Ask for permission.
      const perm = await Notification.requestPermission();
      setPermission(perm as PushPermission);
      if (perm !== "granted") return;

      // 3. Subscribe (reuse an existing subscription if present).
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true, // required by Chromium
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }));
      setSubscription(sub);

      // 4. Persist server-side and fire a test push confirming it works.
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), test: true }),
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [supported]);

  const unsubscribe = useCallback(async () => {
    if (!subscription) return;
    setLoading(true);
    setError(null);
    try {
      const { endpoint } = subscription;
      await subscription.unsubscribe();
      setSubscription(null);
      await fetch("/api/push", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [subscription]);

  return {
    permission,
    isSubscribed: subscription !== null,
    loading,
    error,
    subscribe,
    unsubscribe,
  };
}
