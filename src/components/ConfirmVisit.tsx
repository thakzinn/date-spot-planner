"use client";

import { useCallback, useEffect, useState } from "react";
import { Swal, showLoading, showError } from "@/lib/swal";
import { formatBangkok } from "@/lib/format";
import {
  haversineMeters,
  formatDistance,
  CONFIRM_DISTANCE_THRESHOLD_M,
} from "@/lib/geo";

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

type GeoState =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "ok"; lat: number; lng: number; accuracy: number }
  | { kind: "error"; message: string };

function geoErrorMessage(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED)
    return "Location permission was denied. Enable it in your browser to confirm.";
  if (err.code === err.POSITION_UNAVAILABLE)
    return "Your location is unavailable right now. Try again outdoors.";
  if (err.code === err.TIMEOUT) return "Locating took too long. Try again.";
  return "Couldn't read your location.";
}

export default function ConfirmVisit({
  token,
  place,
}: {
  token: string;
  place: VisitPlace;
}) {
  const [geo, setGeo] = useState<GeoState>({ kind: "idle" });
  const [visited, setVisited] = useState(place.status === "visited");
  const [busy, setBusy] = useState(false);

  const hasPin = Number.isFinite(place.lat) && Number.isFinite(place.lng);
  const distance =
    geo.kind === "ok" && hasPin
      ? haversineMeters(geo.lat, geo.lng, place.lat, place.lng)
      : null;

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

  async function submit() {
    setBusy(true);
    showLoading("Confirming…");
    try {
      const res = await fetch(`/api/places/${place.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        showError(data.error ?? "Couldn't confirm your visit.");
        return;
      }
      setVisited(true);
      await Swal.fire({
        icon: "success",
        title: "Visit confirmed",
        text: place.place_name,
        confirmButtonColor: "#16a34a",
      });
    } catch (e) {
      showError(e instanceof Error ? e.message : "Couldn't confirm your visit.");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm() {
    // Far from the pin? Make the user acknowledge before marking it visited.
    if (distance !== null && distance > CONFIRM_DISTANCE_THRESHOLD_M) {
      const ok = await Swal.fire({
        icon: "warning",
        title: "You're a bit far away",
        html: `You appear to be <b>${formatDistance(distance)}</b> from <b>${escapeHtml(
          place.place_name,
        )}</b>.<br/>Confirm the visit anyway?`,
        showCancelButton: true,
        confirmButtonText: "Confirm anyway",
        cancelButtonText: "Cancel",
        confirmButtonColor: "#db2777",
      });
      if (!ok.isConfirmed) return;
    }
    await submit();
  }

  const near = distance !== null && distance <= CONFIRM_DISTANCE_THRESHOLD_M;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-black/10 dark:border-white/15 p-6 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">{place.place_name}</h1>
          <p className="text-sm opacity-70">{formatBangkok(place.planned_date)}</p>
        </div>

        {visited ? (
          <div className="rounded-lg bg-green-50 px-3 py-4 text-center text-green-800 dark:bg-green-900/30 dark:text-green-200">
            <div className="text-lg font-medium">✅ Visit confirmed</div>
            <p className="text-sm opacity-80">Enjoy your date!</p>
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-black/10 dark:border-white/15 p-3 text-sm">
              {geo.kind === "locating" && <p className="opacity-70">📍 Getting your location…</p>}
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
                      This spot has no pinned coordinates — you can still confirm.
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
                          : `More than ${CONFIRM_DISTANCE_THRESHOLD_M} m away — we'll double-check before confirming.`}
                      </p>
                      <p className="text-xs opacity-50">±{Math.round(geo.accuracy)} m accuracy</p>
                    </>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={onConfirm}
              disabled={busy || geo.kind === "locating"}
              className="w-full rounded-lg bg-green-600 px-3 py-2.5 font-medium text-white disabled:opacity-50"
            >
              Confirm visit
            </button>

            {place.maps_url && (
              <a
                href={place.maps_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center text-sm text-blue-600 underline"
              >
                Open in Maps
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
