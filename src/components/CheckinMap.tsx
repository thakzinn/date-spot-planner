"use client";

import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect } from "react";

const BANGKOK: [number, number] = [13.7563, 100.5018];

function pinIcon(color: string): L.DivIcon {
  const svg = `<svg width="26" height="38" viewBox="0 0 26 38" xmlns="http://www.w3.org/2000/svg"><path d="M13 0C5.82 0 0 5.82 0 13c0 9.5 13 25 13 25s13-15.5 13-25C26 5.82 20.18 0 13 0z" fill="${color}"/><circle cx="13" cy="13" r="4.8" fill="white"/></svg>`;
  return L.divIcon({ className: "dsp-pin", html: svg, iconSize: [26, 38], iconAnchor: [13, 38], popupAnchor: [0, -34] });
}

function dotIcon(color: string): L.DivIcon {
  const html = `<span style="display:block;width:16px;height:16px;border-radius:9999px;background:${color};border:3px solid white;box-shadow:0 0 0 1px ${color}"></span>`;
  return L.divIcon({ className: "dsp-dot", html, iconSize: [16, 16], iconAnchor: [8, 8] });
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 16);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 17 });
  }, [points, map]);
  return null;
}

// Small read-only map: the pinned spot (blue) and the device's current location
// (pink), with a line between them. Either point may be absent.
export default function CheckinMap({
  spot,
  current,
  spotName,
}: {
  spot: [number, number] | null;
  current: [number, number] | null;
  spotName: string;
}) {
  const points = [spot, current].filter((p): p is [number, number] => p !== null);
  const center = current ?? spot ?? BANGKOK;

  return (
    <MapContainer center={center} zoom={15} scrollWheelZoom className="h-full w-full">
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <FitBounds points={points} />
      {spot && current && (
        <Polyline positions={[spot, current]} pathOptions={{ color: "#9ca3af", dashArray: "6 6" }} />
      )}
      {spot && (
        <Marker position={spot} icon={pinIcon("#2563eb")}>
          <Popup>{spotName}</Popup>
        </Marker>
      )}
      {current && (
        <Marker position={current} icon={dotIcon("#db2777")}>
          <Popup>You are here</Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
