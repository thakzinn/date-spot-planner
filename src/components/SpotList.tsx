"use client";

import type { Place, PlaceStatus } from "@/lib/places";
import { formatBangkok } from "@/lib/format";

function badgeCls(status: PlaceStatus): string {
  if (status === "visited") return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300";
  if (status === "cancelled") return "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300";
  return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
}

function statusLabel(status: PlaceStatus): string {
  if (status === "visited") return "ไปแล้ว";
  if (status === "cancelled") return "ยกเลิก";
  return "วางแผนไว้";
}

export default function SpotList({
  places,
  onConfirm,
  onRevert,
  onView,
  onEdit,
  onDelete,
}: {
  places: Place[];
  onConfirm: (id: string) => void;
  onRevert: (id: string) => void;
  onView: (p: Place) => void;
  onEdit: (p: Place) => void;
  onDelete: (id: string) => void;
}) {
  if (places.length === 0) {
    return <p className="py-8 text-center text-sm opacity-60">ไม่มีสถานที่ตรงกับตัวกรองนี้</p>;
  }

  return (
    <ul className="divide-y divide-black/10 dark:divide-white/10">
      {places.map((p) => (
        <li key={p.id} className="flex items-start justify-between gap-3 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{p.place_name}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeCls(p.status)}`}>
                {statusLabel(p.status)}
              </span>
            </div>
            <div className="text-sm opacity-70">{formatBangkok(p.planned_date)}</div>
            {p.category && <div className="text-xs opacity-60">{p.category}</div>}
            {p.invitees.length > 0 && (
              <div
                className="mt-0.5 truncate text-xs opacity-70"
                title={p.invitees.join(", ")}
              >
                👥 {p.invitees.length === 1 ? p.invitees[0] : `เชิญ ${p.invitees.length} คน`}
              </div>
            )}
            {p.notes && <div className="mt-0.5 text-xs opacity-70">{p.notes}</div>}
            {p.maps_url && (
              <a
                href={p.maps_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 underline"
              >
                เปิดใน Maps
              </a>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {p.status === "visited" ? (
              <button
                onClick={() => onRevert(p.id)}
                className="rounded-md bg-gray-200 px-2.5 py-1 text-xs font-medium dark:bg-gray-700"
              >
                ยังไม่ไป
              </button>
            ) : (
              <button
                onClick={() => onConfirm(p.id)}
                className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white"
              >
                ยืนยันว่าไปแล้ว
              </button>
            )}
            <div className="flex items-center gap-2">
              <button onClick={() => onView(p)} className="px-2.5 py-1 text-xs underline opacity-70">
                ดู
              </button>
              <button onClick={() => onEdit(p)} className="px-2.5 py-1 text-xs underline opacity-70">
                แก้ไข
              </button>
              <button
                onClick={() => onDelete(p.id)}
                className="px-2.5 py-1 text-xs text-red-600 underline opacity-70"
              >
                ลบ
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
