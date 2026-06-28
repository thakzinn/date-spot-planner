// Hand-rolled RFC 5545 iCalendar builder. Gives precise control over GEO, the
// "✅ " visited prefix, escaping, CRLF, and line folding.
import type { Place } from "./places";
import { isTodayBangkok } from "./dates";

const PRODID = "-//date-spot-planner//EN";
const EVENT_DURATION_MS = 2 * 60 * 60 * 1000; // 2h default duration

// DISPLAY alarms fired relative to event start: 30 min before, 10 min before,
// and at the moment the event begins. TRIGGER is RELATED=START by default.
const ALARM_TRIGGERS = ["-PT30M", "-PT10M", "PT0S"];

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

// Per-event build options. `confirmUrl` is the "confirm visit" capability link;
// it's only set for today's not-yet-visited events (see buildCalendar).
interface EventOptions {
  confirmUrl?: string;
}

function buildEvent(p: Place, opts: EventOptions = {}): string[] | null {
  const dtstart = toUtcStamp(p.planned_date);
  if (!dtstart) return null; // unusable date — skip

  const startMs = Date.parse(p.planned_date);
  const dtend = toUtcStamp(new Date(startMs + EVENT_DURATION_MS));
  // DTSTAMP/LAST-MODIFIED bound to updated_at (NOT now) to avoid poll churn.
  const stamp = toUtcStamp(p.updated_at) || toUtcStamp(p.created_at) || dtstart;
  const visited = p.status === "visited";
  const summary = (visited ? "✅ " : "") + p.place_name;
  // Put the confirm link first in the description so it's easy to spot on the
  // day — many calendar apps don't surface the URL property prominently.
  const descParts = [
    opts.confirmUrl ? `✅ Confirm your visit: ${opts.confirmUrl}` : "",
    p.notes,
    p.maps_url,
  ].filter((s) => s && s.trim() !== "");

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
  // URL is a URI-typed property — no TEXT escaping. Our links carry no commas
  // or semicolons, so they pass through verbatim (folding still applies).
  if (opts.confirmUrl) lines.push(`URL:${opts.confirmUrl}`);
  lines.push(`STATUS:${visited ? "CONFIRMED" : "TENTATIVE"}`);
  // Reminders: 30 min before, 10 min before, and at start time.
  for (const trigger of ALARM_TRIGGERS) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${esc(summary)}`,
      `TRIGGER:${trigger}`,
      "END:VALARM",
    );
  }
  lines.push("END:VEVENT");
  return lines; // folding happens once, in buildCalendar
}

// Build a single-event VCALENDAR with METHOD:REQUEST — an actual meeting
// invitation (ORGANIZER + ATTENDEEs) that Gmail/Apple render with RSVP buttons.
// Returns "" if the place has an unusable date.
export function buildInvite(
  place: Place,
  organizerEmail: string,
  attendees: string[],
): string {
  const event = buildEvent(place);
  if (!event) return "";

  // Splice ORGANIZER + ATTENDEE lines in right after UID (before END:VEVENT).
  const withPeople = [...event];
  const endIdx = withPeople.indexOf("END:VEVENT");
  const peopleLines = [
    `ORGANIZER;CN=${esc(organizerEmail)}:mailto:${organizerEmail}`,
    ...attendees.map(
      (a) =>
        `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${esc(a)}:mailto:${a}`,
    ),
  ];
  withPeople.splice(endIdx, 0, ...peopleLines);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    ...withPeople,
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

// Options for the published feed. When `confirmBaseUrl` is given, today's
// not-yet-visited events get a short "confirm visit" link (<base>/visit/<id>)
// that opens the check-in page. The page itself gates on the signed-in session
// (creator/invitee), so no token is carried in the URL.
export interface CalendarOptions {
  confirmBaseUrl?: string;
}

// Build a full VCALENDAR from already-filtered places.
export function buildCalendar(places: Place[], opts: CalendarOptions = {}): string {
  const base = opts.confirmBaseUrl?.replace(/\/$/, "");
  const eventLines = places
    .map((p) => {
      const showConfirm = base && p.status !== "visited" && isTodayBangkok(p.planned_date);
      const confirmUrl = showConfirm
        ? `${base}/visit/${encodeURIComponent(p.id)}`
        : undefined;
      return buildEvent(p, { confirmUrl });
    })
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
