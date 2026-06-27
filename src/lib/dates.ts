// Date/time helpers. The app timezone is Asia/Bangkok, which is a FIXED UTC+7
// offset with no daylight saving — so we can format with a literal "+07:00"
// instead of pulling in a timezone database.

const BANGKOK_OFFSET_MIN = 7 * 60; // +07:00, fixed (no DST)

// Window bounds relative to "now": 30 days in the past, 60 days in the future.
export const WINDOW_PAST_DAYS = 30;
export const WINDOW_FUTURE_DAYS = 60;

// Current instant as an ISO 8601 string WITH the Bangkok offset, e.g.
// 2026-06-27T21:15:00+07:00
export function nowBangkokISO(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() + BANGKOK_OFFSET_MIN * 60_000);
  const yyyy = shifted.getUTCFullYear();
  const mm = pad(shifted.getUTCMonth() + 1);
  const dd = pad(shifted.getUTCDate());
  const hh = pad(shifted.getUTCHours());
  const mi = pad(shifted.getUTCMinutes());
  const ss = pad(shifted.getUTCSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+07:00`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Inclusive [today-30d, today+60d] window as absolute instants (ms).
export function windowBounds(now: Date = new Date()): { start: number; end: number } {
  const start = now.getTime() - WINDOW_PAST_DAYS * 86_400_000;
  const end = now.getTime() + WINDOW_FUTURE_DAYS * 86_400_000;
  return { start, end };
}

// True if an ISO datetime string falls inside the window. Invalid/empty -> false.
export function isWithinWindow(isoDate: string, now: Date = new Date()): boolean {
  const t = Date.parse(isoDate);
  if (Number.isNaN(t)) return false;
  const { start, end } = windowBounds(now);
  return t >= start && t <= end;
}
