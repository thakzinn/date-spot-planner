"use client";

import { useEffect, useState } from "react";
import type { Place, PlaceStatus } from "@/lib/places";
import { isoToLocalInput, localInputToISO } from "@/lib/format";
import DateTimePicker from "./DateTimePicker";

export interface SpotPayload {
  place_name: string;
  planned_date: string; // ISO with offset
  lat: number;
  lng: number;
  maps_url: string;
  category: string;
  notes: string;
  status: PlaceStatus;
}

export default function SpotForm({
  initial,
  busy,
  onSave,
  onCancel,
  onPreview,
}: {
  initial: Place | null;
  busy: boolean;
  onSave: (payload: SpotPayload, id: string | null) => void;
  onCancel: () => void;
  onPreview?: (coords: [number, number] | null) => void;
}) {
  const [placeName, setPlaceName] = useState(initial?.place_name ?? "");
  const [localDate, setLocalDate] = useState(
    initial ? isoToLocalInput(initial.planned_date) : "",
  );
  const [lat, setLat] = useState(initial ? String(initial.lat) : "");
  const [lng, setLng] = useState(initial ? String(initial.lng) : "");
  const [mapsUrl, setMapsUrl] = useState(initial?.maps_url ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [status, setStatus] = useState<PlaceStatus>(initial?.status ?? "planned");

  const [extracting, setExtracting] = useState(false);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");

  // Live-preview the typed/extracted coordinates on the map; clear it on unmount.
  useEffect(() => {
    if (!onPreview) return;
    const latN = parseFloat(lat);
    const lngN = parseFloat(lng);
    onPreview(Number.isFinite(latN) && Number.isFinite(lngN) ? [latN, lngN] : null);
    return () => onPreview(null);
  }, [lat, lng, onPreview]);

  async function onExtract() {
    if (!mapsUrl.trim()) return;
    setExtracting(true);
    setHint("");
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: mapsUrl.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setLat(String(data.lat));
        setLng(String(data.lng));
        // Auto-fill the name from the link, but never clobber what's already typed.
        if (data.name && !placeName.trim()) setPlaceName(data.name);
        setHint(
          data.name
            ? `Got ${data.name} — ${data.lat}, ${data.lng}`
            : `Got ${data.lat}, ${data.lng}`,
        );
      } else {
        setHint(data.error ?? "Could not extract coordinates — paste lat, lng manually.");
      }
    } catch {
      setHint("Extraction failed — paste lat, lng manually.");
    } finally {
      setExtracting(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const latN = parseFloat(lat);
    const lngN = parseFloat(lng);
    if (!placeName.trim()) return setError("Name is required.");
    if (!localDate) return setError("Date/time is required.");
    if (!Number.isFinite(latN) || !Number.isFinite(lngN))
      return setError("Latitude and longitude are required (paste a Maps link and Extract, or type them).");

    onSave(
      {
        place_name: placeName.trim(),
        planned_date: localInputToISO(localDate),
        lat: latN,
        lng: lngN,
        maps_url: mapsUrl.trim(),
        category: category.trim(),
        notes,
        status,
      },
      initial?.id ?? null,
    );
  }

  const inputCls =
    "w-full rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 outline-none focus:border-pink-500";

  return (
    <form onSubmit={submit} className="space-y-3">
      <h2 className="text-lg font-semibold">{initial ? "Edit spot" : "Add a spot"}</h2>

      <label className="block text-sm">
        <span className="opacity-70">Google Maps link (optional — for auto name &amp; coordinates)</span>
        <div className="flex gap-2">
          <input
            className={inputCls}
            value={mapsUrl}
            onChange={(e) => setMapsUrl(e.target.value)}
            placeholder="https://maps.app.goo.gl/…"
          />
          <button
            type="button"
            onClick={onExtract}
            disabled={extracting || !mapsUrl.trim()}
            className="shrink-0 rounded-lg border border-black/15 dark:border-white/25 px-3 py-2 text-sm disabled:opacity-50"
          >
            {extracting ? "…" : "Extract"}
          </button>
        </div>
      </label>
      {hint && <p className="text-xs opacity-70">{hint}</p>}

      <label className="block text-sm">
        <span className="opacity-70">Place name</span>
        <input className={inputCls} value={placeName} onChange={(e) => setPlaceName(e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">
          <span className="opacity-70">Latitude</span>
          <input className={inputCls} value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" />
        </label>
        <label className="block text-sm">
          <span className="opacity-70">Longitude</span>
          <input className={inputCls} value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" />
        </label>
      </div>

      <label className="block text-sm">
        <span className="opacity-70">When (Asia/Bangkok)</span>
        <DateTimePicker value={localDate} onChange={setLocalDate} />
      </label>


      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">
          <span className="opacity-70">Category</span>
          <input className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="opacity-70">Status</span>
          <select
            className={inputCls}
            value={status}
            onChange={(e) => setStatus(e.target.value as PlaceStatus)}
          >
            <option value="planned">planned</option>
            <option value="visited">visited</option>
            <option value="cancelled">cancelled</option>
          </select>
        </label>
      </div>

      <label className="block text-sm">
        <span className="opacity-70">Notes</span>
        <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-pink-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : initial ? "Save changes" : "Add spot"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-black/15 dark:border-white/25 px-4 py-2"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
