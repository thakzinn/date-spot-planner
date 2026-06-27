"use client";

import type { Place, PlaceStatus } from "@/lib/places";
import { formatBangkok } from "@/lib/format";

function badgeCls(status: PlaceStatus): string {
  if (status === "visited") return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300";
  if (status === "cancelled") return "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300";
  return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
}

export default function SpotList({
  places,
  onConfirm,
  onRevert,
  onEdit,
}: {
  places: Place[];
  onConfirm: (id: string) => void;
  onRevert: (id: string) => void;
  onEdit: (p: Place) => void;
}) {
  if (places.length === 0) {
    return <p className="py-8 text-center text-sm opacity-60">No spots in this range yet.</p>;
  }

  return (
    <ul className="divide-y divide-black/10 dark:divide-white/10">
      {places.map((p) => (
        <li key={p.id} className="flex items-start justify-between gap-3 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{p.place_name}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeCls(p.status)}`}>
                {p.status}
              </span>
            </div>
            <div className="text-sm opacity-70">{formatBangkok(p.planned_date)}</div>
            {p.category && <div className="text-xs opacity-60">{p.category}</div>}
            {p.notes && <div className="mt-0.5 text-xs opacity-70">{p.notes}</div>}
            {p.maps_url && (
              <a
                href={p.maps_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 underline"
              >
                Open in Maps
              </a>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {p.status === "visited" ? (
              <button
                onClick={() => onRevert(p.id)}
                className="rounded-md bg-gray-200 px-2.5 py-1 text-xs font-medium dark:bg-gray-700"
              >
                Mark planned
              </button>
            ) : (
              <button
                onClick={() => onConfirm(p.id)}
                className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white"
              >
                Confirm visited
              </button>
            )}
            <button onClick={() => onEdit(p)} className="px-2.5 py-1 text-xs underline opacity-70">
              Edit
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
