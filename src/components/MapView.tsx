"use client";

import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import type { Place, PlaceStatus } from "@/lib/places";
import { formatBangkok } from "@/lib/format";

const BANGKOK: [number, number] = [13.7563, 100.5018];

function colorFor(status: PlaceStatus): string {
  if (status === "visited") return "#16a34a"; // green
  if (status === "cancelled") return "#6b7280"; // gray
  return "#2563eb"; // blue (planned)
}

function pinIcon(color: string): L.DivIcon {
  const svg = `<svg width="26" height="38" viewBox="0 0 26 38" xmlns="http://www.w3.org/2000/svg"><path d="M13 0C5.82 0 0 5.82 0 13c0 9.5 13 25 13 25s13-15.5 13-25C26 5.82 20.18 0 13 0z" fill="${color}"/><circle cx="13" cy="13" r="4.8" fill="white"/></svg>`;
  return L.divIcon({
    className: "dsp-pin",
    html: svg,
    iconSize: [26, 38],
    iconAnchor: [13, 38],
    popupAnchor: [0, -34],
  });
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
  }, [points, map]);
  return null;
}

export default function MapView({
  places,
  preview,
  onConfirm,
  onRevert,
}: {
  places: Place[];
  preview?: [number, number] | null;
  onConfirm: (id: string) => void;
  onRevert: (id: string) => void;
}) {
  const pins = places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const points: [number, number][] = pins.map((p) => [p.lat, p.lng]);
  // When a preview point exists, fit/zoom to it too so the user sees where it lands.
  const fitPoints: [number, number][] = preview ? [...points, preview] : points;
  const center = preview ?? points[0] ?? BANGKOK;

  return (
    <MapContainer center={center} zoom={12} scrollWheelZoom className="h-full w-full">
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <FitBounds points={fitPoints} />
      {preview && (
        <Marker position={preview} icon={pinIcon("#db2777")} zIndexOffset={1000}>
          <Popup>
            <div className="text-sm font-semibold">New spot (preview)</div>
            <div className="text-xs opacity-70">
              {preview[0].toFixed(6)}, {preview[1].toFixed(6)}
            </div>
          </Popup>
        </Marker>
      )}
      {pins.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lng]} icon={pinIcon(colorFor(p.status))}>
          <Popup>
            <div className="space-y-1 text-sm">
              <div className="font-semibold">{p.place_name}</div>
              <div className="opacity-70">{formatBangkok(p.planned_date)}</div>
              <div>
                Status: <span className="font-medium">{p.status}</span>
              </div>
              {p.maps_url && (
                <a
                  href={p.maps_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 underline"
                >
                  Open in Maps
                </a>
              )}
              <div className="pt-1">
                {p.status === "visited" ? (
                  <button
                    onClick={() => onRevert(p.id)}
                    className="rounded bg-gray-200 px-2 py-1 text-xs font-medium"
                  >
                    Mark planned
                  </button>
                ) : (
                  <button
                    onClick={() => onConfirm(p.id)}
                    className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white"
                  >
                    Confirm visited
                  </button>
                )}
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
