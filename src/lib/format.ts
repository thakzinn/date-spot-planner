// Pure date formatting helpers (safe on client and server). Bangkok is a fixed
// UTC+7 zone, so wall-clock <-> ISO conversion uses a literal "+07:00".

// Human-readable Bangkok local time, e.g. "Sat, 05 Jul, 18:00".
export function formatBangkok(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

// ISO (with offset) -> value for <input type="datetime-local"> in Bangkok wall time.
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  // en-CA yields hour "24" for midnight in some runtimes; normalize.
  const hh = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hh}:${get("minute")}`;
}

// datetime-local value ("YYYY-MM-DDTHH:mm") -> ISO 8601 with Bangkok offset.
export function localInputToISO(local: string): string {
  if (!local) return "";
  // Already has seconds? keep; else add ":00".
  const withSecs = /T\d{2}:\d{2}$/.test(local) ? `${local}:00` : local;
  return `${withSecs}+07:00`;
}
