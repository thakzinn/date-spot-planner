"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { Place } from "@/lib/places";
import { isWithinWindow } from "@/lib/dates";
import SpotList from "./SpotList";
import SpotForm, { type SpotPayload } from "./SpotForm";

// Leaflet needs the browser — load the map only on the client.
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm opacity-60">Loading map…</div>
  ),
});

export default function HomeView({ feedToken }: { feedToken: string }) {
  const router = useRouter();
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Place | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<[number, number] | null>(null);
  const [feedUrl, setFeedUrl] = useState("");

  const onPreview = useCallback((coords: [number, number] | null) => {
    setPreview(coords);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/places", { cache: "no-store" });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const data = await res.json();
      if (data.ok) setPlaces(data.places as Place[]);
      else setError(data.error ?? "Failed to load");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const displayed = useMemo(() => {
    const list = showAll ? places : places.filter((p) => isWithinWindow(p.planned_date));
    return [...list].sort((a, b) => Date.parse(a.planned_date) - Date.parse(b.planned_date));
  }, [places, showAll]);

  function upsertLocal(updated: Place) {
    setPlaces((prev) => {
      const i = prev.findIndex((p) => p.id === updated.id);
      if (i === -1) return [...prev, updated];
      const next = [...prev];
      next[i] = updated;
      return next;
    });
  }

  async function onSave(payload: SpotPayload, id: string | null) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(id ? `/api/places/${id}` : "/api/places", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      upsertLocal(data.place as Place);
      setShowForm(false);
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function setVisited(id: string, action: "visit" | "unvisit") {
    setError("");
    try {
      const res = await fetch(`/api/places/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Update failed");
        return;
      }
      upsertLocal(data.place as Place);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  }

  // Build the feed URL after mount — window.origin isn't available during SSR,
  // and branching on it during render would cause a hydration mismatch.
  useEffect(() => {
    if (feedToken) {
      setFeedUrl(`${window.location.origin}/api/calendar.ics?token=${feedToken}`);
    }
  }, [feedToken]);

  async function copyFeed() {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; ignore */
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 dark:border-white/10 px-4 py-3">
        <h1 className="text-lg font-semibold">Date Spot Planner</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
            className="rounded-lg bg-pink-600 px-3 py-1.5 text-sm font-medium text-white"
          >
            + Add spot
          </button>
          {feedUrl && (
            <button
              onClick={copyFeed}
              title={feedUrl}
              className="rounded-lg border border-black/15 dark:border-white/25 px-3 py-1.5 text-sm"
            >
              {copied ? "Copied!" : "Copy calendar URL"}
            </button>
          )}
          <button onClick={logout} className="px-2 py-1.5 text-sm underline opacity-70">
            Log out
          </button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-2">
        <section className="order-2 overflow-y-auto p-4 lg:order-1">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-medium">
              Spots{" "}
              <span className="text-sm font-normal opacity-60">
                ({showAll ? "all" : "−30d … +60d"})
              </span>
            </h2>
            <label className="flex items-center gap-1 text-xs opacity-70">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show all dates
            </label>
          </div>

          {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

          {showForm && (
            <div className="mb-4 rounded-xl border border-black/10 dark:border-white/15 p-4">
              <SpotForm
                initial={editing}
                busy={busy}
                onSave={onSave}
                onPreview={onPreview}
                onCancel={() => {
                  setShowForm(false);
                  setEditing(null);
                }}
              />
            </div>
          )}

          {loading ? (
            <p className="py-8 text-center text-sm opacity-60">Loading…</p>
          ) : (
            <SpotList
              places={displayed}
              onConfirm={(id) => setVisited(id, "visit")}
              onRevert={(id) => setVisited(id, "unvisit")}
              onEdit={(p) => {
                setEditing(p);
                setShowForm(true);
              }}
            />
          )}
        </section>

        <section className="order-1 h-[40vh] lg:order-2 lg:h-auto">
          <MapView
            places={displayed}
            preview={showForm ? preview : null}
            onConfirm={(id) => setVisited(id, "visit")}
            onRevert={(id) => setVisited(id, "unvisit")}
          />
        </section>
      </div>
    </div>
  );
}
