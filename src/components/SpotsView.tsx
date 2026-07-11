"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Swal, showLoading, showSuccess, showError } from "@/lib/swal";
import type { Place } from "@/lib/places";
import { formatBangkok } from "@/lib/format";
import { bangkokDateStr } from "@/lib/dates";
import SpotList from "./SpotList";
import SpotForm, { type SpotPayload } from "./SpotForm";
import Segmented from "./Segmented";

type SpotScope = "me" | "invited" | "all";
type SpotPeriod = "current" | "past" | "all";

// Leaflet needs the browser — load the map only on the client.
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm opacity-60">Loading map…</div>
  ),
});

export default function SpotsView({ userEmail }: { userEmail: string }) {
  const router = useRouter();
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Place | null>(null);
  const [busy, setBusy] = useState(false);
  // Who owns the spot (Me / Invited / All) and where it sits in time
  // (Current = planned & not past due, Past = visited/cancelled or date gone by).
  const [scope, setScope] = useState<SpotScope>("all");
  const [period, setPeriod] = useState<SpotPeriod>("current");
  const [preview, setPreview] = useState<[number, number] | null>(null);

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

  // A spot is "ours" when we created it; otherwise we only see it via an invite.
  const me = userEmail.trim().toLowerCase();

  const displayed = useMemo(() => {
    const today = bangkokDateStr();
    // Past = already visited/cancelled, or its planned date has gone by.
    const isPast = (p: Place) => {
      if (p.status !== "planned") return true;
      const d = Date.parse(p.planned_date);
      return !Number.isNaN(d) && bangkokDateStr(new Date(d)) < today;
    };
    const list = places.filter((p) => {
      if (scope === "me" && p.created_by.trim().toLowerCase() !== me) return false;
      if (scope === "invited" && p.created_by.trim().toLowerCase() === me) return false;
      if (period === "current" && isPast(p)) return false;
      if (period === "past" && !isPast(p)) return false;
      return true;
    });
    return [...list].sort((a, b) => Date.parse(a.planned_date) - Date.parse(b.planned_date));
  }, [places, scope, period, me]);

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
    setNotice("");
    showLoading(id ? "Saving changes…" : "Adding spot…");
    try {
      const res = await fetch(id ? `/api/places/${id}` : "/api/places", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Save failed");
        showError(data.error ?? "Save failed");
        return;
      }
      upsertLocal(data.place as Place);
      setNotice(describeInvite(data.invite));
      setShowForm(false);
      setEditing(null);
      showSuccess(id ? "Changes saved" : "Spot added");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setError(msg);
      showError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function setVisited(id: string, action: "visit" | "unvisit") {
    setError("");
    showLoading("Updating…");
    try {
      const res = await fetch(`/api/places/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Update failed");
        showError(data.error ?? "Update failed");
        return;
      }
      upsertLocal(data.place as Place);
      showSuccess(action === "visit" ? "Marked visited" : "Marked planned");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Update failed";
      setError(msg);
      showError(msg);
    }
  }

  function onView(p: Place) {
    Swal.fire({
      title: esc(p.place_name),
      html: detailsHtml(p),
      confirmButtonText: "Close",
      confirmButtonColor: "#db2777",
    });
  }

  async function onDelete(id: string) {
    const confirmed = await Swal.fire({
      title: "Delete this spot?",
      text: "It will be hidden from your list and calendar.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#dc2626",
    });
    if (!confirmed.isConfirmed) return;
    setError("");
    showLoading("Deleting…");
    try {
      const res = await fetch(`/api/places/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Delete failed");
        showError(data.error ?? "Delete failed");
        return;
      }
      setPlaces((prev) => prev.filter((p) => p.id !== id));
      showSuccess("Spot deleted");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      setError(msg);
      showError(msg);
    }
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_1fr] lg:grid-cols-2 lg:grid-rows-1">
        <section className="order-2 min-h-0 overflow-y-auto p-4 lg:order-1">
          <div className="mb-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-medium">สถานที่</h2>
              <button
                onClick={() => {
                  setEditing(null);
                  setShowForm(true);
                }}
                className="rounded-lg bg-pink-600 px-3 py-1.5 text-sm font-medium text-white"
              >
                + เพิ่มสถานที่
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
          </div>

          {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
          {notice && (
            <p className="mb-2 flex items-start justify-between gap-2 rounded-lg bg-pink-50 px-3 py-2 text-sm text-pink-800 dark:bg-pink-900/30 dark:text-pink-200">
              <span>{notice}</span>
              <button
                onClick={() => setNotice("")}
                aria-label="Dismiss"
                className="shrink-0 opacity-60 hover:opacity-100"
              >
                ×
              </button>
            </p>
          )}

          {showForm && (
            <div className="mb-4 rounded-xl border border-black/10 dark:border-white/15 p-4">
              <SpotForm
                // Remount when switching spots (or to "add") so the form's
                // initial-seeded state can't linger from a previous edit.
                key={editing?.id ?? "new"}
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
              onView={onView}
              onEdit={(p) => {
                setEditing(p);
                setShowForm(true);
              }}
              onDelete={onDelete}
            />
          )}
        </section>

        <section className="order-1 min-h-0 h-[40vh] lg:order-2 lg:h-auto">
          <MapView
            places={displayed}
            preview={showForm ? preview : null}
            onConfirm={(id) => setVisited(id, "visit")}
            onRevert={(id) => setVisited(id, "unvisit")}
          />
        </section>
    </div>
  );
}

// Shape returned by the places API under `invite` (mirrors lib/gmail
// SendInvitesResult); null when there was nobody to notify.
interface InviteResult {
  sent: string[];
  failed: string[];
  error?: string;
}

// Turn an invite outcome into a one-line user notice ("" = show nothing).
function describeInvite(invite: InviteResult | null | undefined): string {
  if (!invite) return "";
  const sent = invite.sent?.length ?? 0;
  if (invite.error === "no_gmail_grant") {
    return "Spot saved, but invites couldn't be sent — log out and sign in again to grant Gmail access, then re-add the invitee.";
  }
  if (invite.failed?.length && sent === 0) {
    return "Spot saved, but the invite email failed to send. Try editing the spot to retry.";
  }
  if (sent > 0) {
    const partial = invite.failed?.length ? ` (${invite.failed.length} failed)` : "";
    return `Invite emailed to ${sent} ${sent === 1 ? "person" : "people"}${partial}.`;
  }
  return "";
}

// Escape user-supplied text before dropping it into Swal's `html`.
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

// Build the read-only details body for the View modal.
function detailsHtml(p: Place): string {
  const rows: Array<[string, string]> = [
    ["Status", p.status],
    ["When", formatBangkok(p.planned_date)],
  ];
  if (p.category) rows.push(["Category", p.category]);
  if (p.invitees.length > 0) rows.push(["Invitees", p.invitees.join(", ")]);
  if (p.notes) rows.push(["Notes", p.notes]);
  if (p.status === "visited" && p.visited_at) rows.push(["Visited", formatBangkok(p.visited_at)]);

  const list = rows
    .map(
      ([label, value]) =>
        `<div style="margin-bottom:6px"><span style="opacity:.6">${esc(label)}:</span> ${esc(value)}</div>`,
    )
    .join("");

  const maps = p.maps_url
    ? `<div style="margin-top:10px"><a href="${esc(p.maps_url)}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline">Open in Maps</a></div>`
    : "";

  return `<div style="text-align:left;font-size:14px">${list}${maps}</div>`;
}
