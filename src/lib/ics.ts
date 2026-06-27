// Hand-rolled RFC 5545 iCalendar builder. Gives precise control over GEO, the
// "✅ " visited prefix, escaping, CRLF, and line folding.
import type { Place } from "./places";

const PRODID = "-//date-spot-planner//EN";
const EVENT_DURATION_MS = 2 * 60 * 60 * 1000; // 2h default duration

// Escape per RFC 5545 §3.3.11 (TEXT): backslash, semicolon, comma, newlines.
function esc(text: string): string {
  return (text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// UTC timestamp form: YYYYMMDDTHHMMSSZ
function toUtcStamp(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

// Fold lines to <=75 octets (UTF-8 aware), continuation lines start with a space.
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  for (const ch of line) {
    const chBytes = Buffer.byteLength(ch, "utf8");
    // first line budget 75, continuation lines budget 74 (leading space)
    const limit = out.length === 0 ? 75 : 74;
    if (chunkBytes + chBytes > limit) {
      out.push(chunk);
      chunk = "";
      chunkBytes = 0;
    }
    chunk += ch;
    chunkBytes += chBytes;
  }
  if (chunk) out.push(chunk);
  return out.map((c, i) => (i === 0 ? c : " " + c)).join("\r\n");
}

// SEQUENCE must stay within int32 and grow on edits. Seconds between create and
// last update fits comfortably and is monotonic per place.
function sequenceFor(p: Place): number {
  const created = Date.parse(p.created_at);
  const updated = Date.parse(p.updated_at);
  if (Number.isNaN(created) || Number.isNaN(updated)) return 0;
  return Math.max(0, Math.floor((updated - created) / 1000));
}

function buildEvent(p: Place): string[] | null {
  const dtstart = toUtcStamp(p.planned_date);
  if (!dtstart) return null; // unusable date — skip

  const startMs = Date.parse(p.planned_date);
  const dtend = toUtcStamp(new Date(startMs + EVENT_DURATION_MS));
  // DTSTAMP/LAST-MODIFIED bound to updated_at (NOT now) to avoid poll churn.
  const stamp = toUtcStamp(p.updated_at) || toUtcStamp(p.created_at) || dtstart;
  const visited = p.status === "visited";
  const summary = (visited ? "✅ " : "") + p.place_name;
  const descParts = [p.notes, p.maps_url].filter((s) => s && s.trim() !== "");

  const lines = [
    "BEGIN:VEVENT",
    `UID:${p.id}@datespot`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SEQUENCE:${sequenceFor(p)}`,
    `LAST-MODIFIED:${stamp}`,
    `SUMMARY:${esc(summary)}`,
  ];
  if (descParts.length) lines.push(`DESCRIPTION:${esc(descParts.join("\n"))}`);
  lines.push(`LOCATION:${esc(p.place_name)}`);
  if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
    lines.push(`GEO:${p.lat};${p.lng}`);
  }
  lines.push(`STATUS:${visited ? "CONFIRMED" : "TENTATIVE"}`);
  lines.push("END:VEVENT");
  return lines; // folding happens once, in buildCalendar
}

// Build a full VCALENDAR from already-filtered places.
export function buildCalendar(places: Place[]): string {
  const eventLines = places
    .map(buildEvent)
    .filter((e): e is string[] => e !== null)
    .flat();

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Date Spots",
    "X-WR-TIMEZONE:Asia/Bangkok",
    ...eventLines,
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
