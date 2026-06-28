"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Swal, showLoading, showError } from "@/lib/swal";
import { formatBangkok } from "@/lib/format";
import {
  haversineMeters,
  formatDistance,
  CONFIRM_DISTANCE_THRESHOLD_M,
} from "@/lib/geo";

// Leaflet needs the browser — load the map only on the client.
const CheckinMap = dynamic(() => import("./CheckinMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm opacity-60">Loading map…</div>
  ),
});

// The slice of Place the check-in page needs (server passes only these fields).
interface VisitPlace {
  id: string;
  place_name: string;
  lat: number;
  lng: number;
  maps_url: string;
  planned_date: string;
  status: "planned" | "visited" | "cancelled";
}

interface NoticeResult {
  sent: string[];
  failed: string[];
  error?: string;
}

type GeoState =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "ok"; lat: number; lng: number; accuracy: number }
  | { kind: "error"; message: string };

function geoErrorMessage(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED)
    return "Location permission was denied. Enable it in your browser to check in.";
  if (err.code === err.POSITION_UNAVAILABLE)
    return "Your location is unavailable right now. Try again outdoors.";
  if (err.code === err.TIMEOUT) return "Locating took too long. Try again.";
  return "Couldn't read your location.";
}

export default function ConfirmVisit({ place }: { place: VisitPlace }) {
  const [geo, setGeo] = useState<GeoState>({ kind: "idle" });
  const [visited, setVisited] = useState(place.status === "visited");
  const [busy, setBusy] = useState(false);

  const hasPin = Number.isFinite(place.lat) && Number.isFinite(place.lng);
  const spot: [number, number] | null = hasPin ? [place.lat, place.lng] : null;
  const current: [number, number] | null = geo.kind === "ok" ? [geo.lat, geo.lng] : null;
  const distance =
    geo.kind === "ok" && hasPin ? haversineMeters(geo.lat, geo.lng, place.lat, place.lng) : null;

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGeo({ kind: "error", message: "This device can't share its location." });
      return;
    }
    setGeo({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setGeo({
          kind: "ok",
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => setGeo({ kind: "error", message: geoErrorMessage(err) }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }, []);

  // Ask for location as soon as the page opens (unless already checked in).
  // Deferred a tick so the effect body doesn't setState synchronously.
  useEffect(() => {
    if (visited) return;
    const t = setTimeout(locate, 0);
    return () => clearTimeout(t);
  }, [visited, locate]);

  function describeNotice(notice: NoticeResult | null | undefined): string {
    if (!notice) return "";
    if (notice.error === "no_gmail_grant")
      return "Checked in. Couldn't notify others — sign in again to grant Gmail access.";
    const sent = notice.sent?.length ?? 0;
    if (sent > 0) return `Notified ${sent} ${sent === 1 ? "person" : "people"} of your arrival.`;
    if (notice.failed?.length) return "Checked in, but the arrival email failed to send.";
    return "";
  }

  async function submit(lat: number, lng: number) {
    setBusy(true);
    showLoading("Checking in…");
    try {
      const res = await fetch(`/api/places/${place.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        showError(data.error ?? "Couldn't check in.");
        return;
      }
      setVisited(true);
      const msg = describeNotice(data.notice);
      await Swal.fire({
        icon: "success",
        title: "Checked in",
        text: msg || place.place_name,
        confirmButtonColor: "#16a34a",
      });
    } catch (e) {
      showError(e instanceof Error ? e.message : "Couldn't check in.");
    } finally {
      setBusy(false);
    }
  }

  async function onCheckIn() {
    if (geo.kind !== "ok") {
      showError("We need your current location to check in.");
      return;
    }
    // Far from the pin? Make the user acknowledge before checking in.
    if (distance !== null && distance > CONFIRM_DISTANCE_THRESHOLD_M) {
      const ok = await Swal.fire({
        icon: "warning",
        title: "You're a bit far away",
        html: `You appear to be <b>${formatDistance(distance)}</b> from <b>${escapeHtml(
          place.place_name,
        )}</b>.<br/>Check in anyway?`,
        showCancelButton: true,
        confirmButtonText: "Check in anyway",
        cancelButtonText: "Cancel",
        confirmButtonColor: "#db2777",
      });
      if (!ok.isConfirmed) return;
    }
    await submit(geo.lat, geo.lng);
  }

  const near = distance !== null && distance <= CONFIRM_DISTANCE_THRESHOLD_M;

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-black/10 dark:border-white/15 p-5 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">{place.place_name}</h1>
          <p className="text-sm opacity-70">{formatBangkok(place.planned_date)}</p>
        </div>

        <div className="h-56 overflow-hidden rounded-lg border border-black/10 dark:border-white/15">
          <CheckinMap spot={spot} current={current} spotName={place.place_name} />
        </div>

        {visited ? (
          <div className="rounded-lg bg-green-50 px-3 py-4 text-center text-green-800 dark:bg-green-900/30 dark:text-green-200">
            <div className="text-lg font-medium">✅ Checked in</div>
            <p className="text-sm opacity-80">Enjoy your date!</p>
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-black/10 dark:border-white/15 p-3 text-sm">
              {geo.kind === "locating" && <p className="opacity-70">📍 Getting your location…</p>}
              {geo.kind === "idle" && <p className="opacity-70">📍 Preparing…</p>}
              {geo.kind === "error" && (
                <div className="space-y-2">
                  <p className="text-red-600">{geo.message}</p>
                  <button onClick={locate} className="text-sm underline opacity-80">
                    Try again
                  </button>
                </div>
              )}
              {geo.kind === "ok" && (
                <div className="space-y-1">
                  {!hasPin ? (
                    <p className="opacity-70">
                      This spot has no pinned coordinates — you can still check in.
                    </p>
                  ) : (
                    <>
                      <p>
                        Distance to spot:{" "}
                        <span className={`font-semibold ${near ? "text-green-600" : "text-amber-600"}`}>
                          {formatDistance(distance!)}
                        </span>
                      </p>
                      <p className="text-xs opacity-60">
                        {near
                          ? "You're here 🎉"
                          : `More than ${CONFIRM_DISTANCE_THRESHOLD_M} m away — we'll double-check before checking in.`}
                      </p>
                      <p className="text-xs opacity-50">±{Math.round(geo.accuracy)} m accuracy</p>
                    </>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={onCheckIn}
              disabled={busy || geo.kind !== "ok"}
              className="w-full rounded-lg bg-green-600 px-3 py-2.5 font-medium text-white disabled:opacity-50"
            >
              Check in & notify
            </button>

            {place.maps_url && (
              <a
                href={place.maps_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center text-sm text-blue-600 underline"
              >
                Open spot in Maps
              </a>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
