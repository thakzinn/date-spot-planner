// Hand-rolled RFC 5545 iCalendar builder. Gives precise control over GEO, the
// "✅ " visited prefix, escaping, CRLF, and line folding.
import type { Place } from "./places";
import type { Milestone, Plan } from "./plans";
import { isTodayBangkok } from "./dates";

const PRODID = "-//date-spot-planner//EN";
const EVENT_DURATION_MS = 2 * 60 * 60 * 1000; // 2h default duration

// The app timezone. Asia/Bangkok is a fixed UTC+7 offset with no DST, so we can
// derive local wall-clock stamps by shifting the instant and formatting without
// a trailing "Z". Apple Calendar recognizes the IANA name, so we omit VTIMEZONE
// (mirrors the reference feed the app is modeled on).
const TZID = "Asia/Bangkok";
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

// DISPLAY alarms fired relative to event start: 30 min before, 10 min before,
// and at the moment the event begins. TRIGGER is RELATED=START by default.
const ALARM_TRIGGERS = ["-PT30M", "-PT10M", "PT0S"];

// Timeline milestones/checkpoints are day-scale deadlines, so remind earlier:
// a day before, 2 hours before, and at the due moment.
const MILESTONE_ALARM_TRIGGERS = ["-P1D", "-PT2H", "PT0S"];

// Escape per RFC 5545 §3.3.11 (TEXT): backslash, semicolon, comma, newlines.
function esc(text: string): string {
  return (text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// UTC timestamp form: YYYYMMDDTHHMMSSZ (used for DTSTAMP/LAST-MODIFIED).
function toUtcStamp(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

// Bangkok local wall-clock form: YYYYMMDDTHHMMSS (no "Z"). Paired with a
// ;TZID=Asia/Bangkok parameter on DTSTART/DTEND so Apple shows the event at the
// intended local time. Shift the instant by +07:00, then read the UTC fields.
function toBangkokLocalStamp(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + BANGKOK_OFFSET_MS)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "");
}

// Apple-specific structured location: gives Calendar a tappable map pin. The
// X-TITLE parameter value is quoted so a place name with spaces/commas is legal
// per RFC 5545 §3.2 (inner quotes stripped). X-ADDRESS mirrors the reference
// feed by carrying the escaped "lat,lng" string.
function appleStructuredLocation(title: string, lat: number, lng: number): string {
  const geo = `${lat},${lng}`;
  const xtitle = `"${(title ?? "").replace(/"/g, "")}"`;
  return `X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS=${esc(geo)};X-APPLE-RADIUS=49;X-TITLE=${xtitle}:geo:${geo}`;
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
  const dtstart = toBangkokLocalStamp(p.planned_date);
  if (!dtstart) return null; // unusable date — skip

  const startMs = Date.parse(p.planned_date);
  const dtend = toBangkokLocalStamp(new Date(startMs + EVENT_DURATION_MS));
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
    `TZID:${TZID}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=${TZID}:${dtstart}`,
    `DTEND;TZID=${TZID}:${dtend}`,
    `SEQUENCE:${sequenceFor(p)}`,
    `LAST-MODIFIED:${stamp}`,
    `SUMMARY:${esc(summary)}`,
  ];
  if (descParts.length) lines.push(`DESCRIPTION:${esc(descParts.join("\n"))}`);
  lines.push(`LOCATION:${esc(p.place_name)}`);
  if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
    lines.push(`GEO:${p.lat};${p.lng}`);
    lines.push(appleStructuredLocation(p.place_name, p.lat, p.lng));
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

// ---- timeline (plan milestone / checkpoint) events --------------------------

interface TimelineEvent {
  uid: string; // full UID including the @suffix
  summary: string;
  dueDate: string; // ISO 8601
  done: boolean;
  stamp: string; // ISO for DTSTAMP/LAST-MODIFIED (the parent milestone's updated_at)
  description?: string;
}

// A deadline-style VEVENT for a milestone or dated checkpoint. Done items are
// marked CONFIRMED with a "✅ " prefix and carry no alarms.
function buildTimelineEvent(ev: TimelineEvent): string[] | null {
  const dtstart = toBangkokLocalStamp(ev.dueDate);
  if (!dtstart) return null;
  const dtend = toBangkokLocalStamp(new Date(Date.parse(ev.dueDate) + EVENT_DURATION_MS));
  const stamp = toUtcStamp(ev.stamp) || toUtcStamp(ev.dueDate);
  const summary = (ev.done ? "✅ " : "") + ev.summary;

  const lines = [
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `TZID:${TZID}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=${TZID}:${dtstart}`,
    `DTEND;TZID=${TZID}:${dtend}`,
    `LAST-MODIFIED:${stamp}`,
    `SUMMARY:${esc(summary)}`,
  ];
  if (ev.description) lines.push(`DESCRIPTION:${esc(ev.description)}`);
  lines.push(`STATUS:${ev.done ? "CONFIRMED" : "TENTATIVE"}`);
  if (!ev.done) {
    for (const trigger of MILESTONE_ALARM_TRIGGERS) {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${esc(summary)}`,
        `TRIGGER:${trigger}`,
        "END:VALARM",
      );
    }
  }
  lines.push("END:VEVENT");
  return lines;
}

// Build the VEVENT lines for a milestone plus any of its dated checkpoints.
// `planTitle` prefixes the summary so events read e.g. "อ่าน X · บทที่ 1".
export function buildMilestoneEvents(m: Milestone, planTitle: string): string[] {
  const base = planTitle ? `${planTitle} · ${m.title}` : m.title;
  const stamp = m.updated_at || m.created_at;
  const groups: string[][] = [];

  const ms = buildTimelineEvent({
    uid: `${m.id}@datespot-ms`,
    summary: base,
    dueDate: m.due_date,
    done: m.status === "done",
    stamp,
    description: m.notes || undefined,
  });
  if (ms) groups.push(ms);

  for (const c of m.checkpoints) {
    if (!c.due_date) continue; // checkpoints without their own date ride the milestone
    const cp = buildTimelineEvent({
      uid: `${c.id}@datespot-cp`,
      summary: `${base} — ${c.title}`,
      dueDate: c.due_date,
      done: c.done,
      stamp,
    });
    if (cp) groups.push(cp);
  }
  return groups.flat();
}

// A deadline-style VEVENT for a whole plan, anchored on its overall due_date.
// Returns [] if the plan has no usable due_date. The "🎯 " prefix mirrors how
// plan deadlines read in the app's UI.
export function buildPlanEvents(p: Plan): string[] {
  const ev = buildTimelineEvent({
    uid: `${p.id}@datespot-plan`,
    summary: `🎯 ${p.title}`,
    dueDate: p.due_date,
    done: p.status === "done",
    stamp: p.updated_at || p.created_at,
    description: p.description || undefined,
  });
  return ev ?? [];
}

// ---- calendar wrapper -------------------------------------------------------

// Options for the published feed. When `confirmBaseUrl` is given, today's
// not-yet-visited events get a short "confirm visit" link (<base>/visit/<id>)
// that opens the check-in page. The page itself gates on the signed-in session
// (creator/invitee), so no token is carried in the URL.
export interface CalendarOptions {
  confirmBaseUrl?: string;
  calName?: string;
}

// Map already-filtered places to their VEVENT lines (no VCALENDAR wrapper).
export function placeEventLines(places: Place[], opts: CalendarOptions = {}): string[] {
  const base = opts.confirmBaseUrl?.replace(/\/$/, "");
  return places
    .map((p) => {
      const showConfirm = base && p.status !== "visited" && isTodayBangkok(p.planned_date);
      const confirmUrl = showConfirm
        ? `${base}/visit/${encodeURIComponent(p.id)}`
        : undefined;
      return buildEvent(p, { confirmUrl });
    })
    .filter((e): e is string[] => e !== null)
    .flat();
}

// Wrap arbitrary VEVENT lines in a published VCALENDAR (folded, CRLF-joined).
export function wrapCalendar(eventLines: string[], opts: { calName?: string } = {}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(opts.calName ?? "Date Spots")}`,
    "X-WR-TIMEZONE:Asia/Bangkok",
    ...eventLines,
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

// Build a full VCALENDAR from already-filtered places (unchanged public API).
export function buildCalendar(places: Place[], opts: CalendarOptions = {}): string {
  return wrapCalendar(placeEventLines(places, opts), { calName: opts.calName });
}
