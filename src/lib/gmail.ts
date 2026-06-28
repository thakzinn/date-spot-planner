// Send date invitations via the Gmail API, "as" the signed-in user. Server-only.
// We authenticate with the user's stored Gmail refresh token (see lib/sheets
// getUserGmailToken) and POST a MIME message to users.messages.send. The message
// carries a text/calendar (METHOD:REQUEST) part so it lands as a real calendar
// invitation with RSVP buttons.
import { randomUUID } from "node:crypto";
import { refreshTokenClient } from "./google-oauth";
import { buildInvite } from "./ics";
import { formatBangkok } from "./format";
import { googleMapsLink, openStreetMapLink } from "./geo";
import type { Place } from "./places";

const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

// Encode a header value that may contain non-ASCII (e.g. Thai) per RFC 2047.
function encodeHeader(value: string): string {
  // ASCII-only -> safe as-is; otherwise base64-encode the whole word.
  if (/^[ -~]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

// A base64 MIME body part. base64 keeps UTF-8 (Thai names) and folded ICS lines
// intact without 7bit/line-length pitfalls. `extraHeaders` add things like
// Content-Disposition for attachments.
function base64Part(contentType: string, body: string, extraHeaders: string[] = []): string {
  const encoded = Buffer.from(body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return [
    `Content-Type: ${contentType}`,
    "Content-Transfer-Encoding: base64",
    ...extraHeaders,
    "",
    encoded,
  ].join("\r\n");
}

// Assemble the full RFC 5322 message ready for base64url transport. Structure:
//   multipart/mixed
//   ├─ multipart/alternative
//   │  ├─ text/plain                          (fallback body)
//   │  └─ text/calendar; method=REQUEST       (inline → Gmail/Calendar show RSVP)
//   └─ application/ics  invite.ics            (attachment → openable in any client)
// The calendar part appears BOTH inline (for RSVP rendering) and as a file
// attachment (so clients that don't auto-render still get an importable event).
function buildMime(args: {
  fromName: string;
  fromEmail: string;
  to: string[];
  subject: string;
  text: string;
  ics: string;
}): string {
  const mixed = `dsp_mixed_${randomUUID().replace(/-/g, "")}`;
  const alt = `dsp_alt_${randomUUID().replace(/-/g, "")}`;

  const headers = [
    `From: ${encodeHeader(args.fromName)} <${args.fromEmail}>`,
    `To: ${args.to.join(", ")}`,
    `Subject: ${encodeHeader(args.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
  ].join("\r\n");

  const body = [
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    base64Part('text/plain; charset="UTF-8"', args.text),
    `--${alt}`,
    // method=REQUEST on the part matters: Gmail keys off it to show RSVP.
    base64Part('text/calendar; charset="UTF-8"; method=REQUEST', args.ics),
    `--${alt}--`,
    "",
    `--${mixed}`,
    base64Part('application/ics; name="invite.ics"', args.ics, [
      'Content-Disposition: attachment; filename="invite.ics"',
    ]),
    `--${mixed}--`,
    "",
  ].join("\r\n");

  return headers + "\r\n" + body;
}

// Plain-text fallback body shown by clients that ignore the calendar part.
function inviteText(place: Place, fromName: string): string {
  const when = formatBangkok(place.planned_date);
  const lines = [
    `${fromName} invited you to a date spot:`,
    "",
    `📍 ${place.place_name}`,
    `🗓️ ${when} (Asia/Bangkok)`,
  ];
  if (place.maps_url) lines.push(`🗺️ ${place.maps_url}`);
  if (place.notes) lines.push("", place.notes);
  lines.push("", "This invite includes a calendar event — tap to RSVP.");
  return lines.join("\n");
}

export interface SendInvitesResult {
  sent: string[];
  failed: string[];
  error?: string; // set when nothing could be sent (e.g. no token)
}

// Send a calendar invitation for `place` from `organizer` to each recipient.
// One message addressed to all recipients (a single thread). Best-effort: a
// transport failure is reported, never thrown.
export async function sendInvites(
  organizer: { email: string; name: string },
  refreshToken: string,
  place: Place,
  recipients: string[],
): Promise<SendInvitesResult> {
  const to = recipients.filter((r) => r && r !== organizer.email);
  if (to.length === 0) return { sent: [], failed: [] };
  if (!refreshToken) {
    return {
      sent: [],
      failed: to,
      error: "no_gmail_grant", // organizer hasn't granted Gmail send — must re-login
    };
  }

  const ics = buildInvite(place, organizer.email, to);
  if (!ics) return { sent: [], failed: to, error: "bad_event" };

  const raw = Buffer.from(
    buildMime({
      fromName: organizer.name,
      fromEmail: organizer.email,
      to,
      subject: `Invitation: ${place.place_name} — ${formatBangkok(place.planned_date)}`,
      text: inviteText(place, organizer.name),
      ics,
    }),
    "utf8",
  ).toString("base64url");

  try {
    await refreshTokenClient(refreshToken).request({
      url: SEND_URL,
      method: "POST",
      data: { raw },
    });
    return { sent: to, failed: [] };
  } catch (err) {
    return {
      sent: [],
      failed: to,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---- arrival check-in notice -------------------------------------------------
// A plain text+HTML email (no calendar part) telling everyone on the plan that
// the sender has arrived, with their live location as Google Maps + OSM links.

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

// multipart/alternative MIME (text/plain + text/html), base64 parts.
function buildAlternativeMime(args: {
  fromName: string;
  fromEmail: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}): string {
  const alt = `dsp_alt_${randomUUID().replace(/-/g, "")}`;
  const headers = [
    `From: ${encodeHeader(args.fromName)} <${args.fromEmail}>`,
    `To: ${args.to.join(", ")}`,
    `Subject: ${encodeHeader(args.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
  ].join("\r\n");

  const body = [
    `--${alt}`,
    base64Part('text/plain; charset="UTF-8"', args.text),
    `--${alt}`,
    base64Part('text/html; charset="UTF-8"', args.html),
    `--${alt}--`,
    "",
  ].join("\r\n");

  return headers + "\r\n" + body;
}

export interface ArrivalResult {
  sent: string[];
  failed: string[];
  error?: string;
}

// Tell `recipients` that `actor` has checked in at `place`, sharing their
// current coordinates. Sent "as" the actor via their Gmail grant. Best-effort:
// reports failures, never throws.
export async function sendArrivalNotice(
  actor: { email: string; name: string },
  refreshToken: string,
  place: Place,
  recipients: string[],
  location: { lat: number; lng: number },
): Promise<ArrivalResult> {
  const to = recipients.filter((r) => r && r !== actor.email);
  if (to.length === 0) return { sent: [], failed: [] };
  if (!refreshToken) return { sent: [], failed: to, error: "no_gmail_grant" };

  const gmaps = googleMapsLink(location.lat, location.lng);
  const osm = openStreetMapLink(location.lat, location.lng);
  const coords = `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`;
  const subject = `📍 ${actor.name} arrived at ${place.place_name}`;

  const text = [
    `${actor.name} has checked in at ${place.place_name}.`,
    "",
    `Current location: ${coords}`,
    `Google Maps: ${gmaps}`,
    `OpenStreetMap: ${osm}`,
  ].join("\n");

  const html =
    `<div style="font-family:system-ui,Arial,sans-serif;font-size:14px;line-height:1.5">` +
    `<p><b>${escapeHtml(actor.name)}</b> has checked in at <b>${escapeHtml(place.place_name)}</b>.</p>` +
    `<p>Current location: <b>${escapeHtml(coords)}</b></p>` +
    `<p>` +
    `📍 <a href="${gmaps}">Open in Google Maps</a><br/>` +
    `🗺️ <a href="${osm}">Open in OpenStreetMap</a>` +
    `</p></div>`;

  const raw = Buffer.from(
    buildAlternativeMime({
      fromName: actor.name,
      fromEmail: actor.email,
      to,
      subject,
      text,
      html,
    }),
    "utf8",
  ).toString("base64url");

  try {
    await refreshTokenClient(refreshToken).request({
      url: SEND_URL,
      method: "POST",
      data: { raw },
    });
    return { sent: to, failed: [] };
  } catch (err) {
    return { sent: [], failed: to, error: err instanceof Error ? err.message : String(err) };
  }
}
