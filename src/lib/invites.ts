// Orchestrates sending date invites: looks up the organizer's stored Gmail
// refresh token, then delegates to lib/gmail. Server-only. Always best-effort —
// returns a summary and never throws, so a mail failure can't break a save.
import type { SessionUser } from "./auth";
import { getUserGmailToken } from "./sheets";
import { sendInvites, type SendInvitesResult } from "./gmail";
import type { Place } from "./places";

// Send invites for `place` to `recipients` as `organizer`. Returns null when
// there's nobody to notify (so callers can omit it from the response).
export async function maybeInvite(
  organizer: SessionUser,
  place: Place,
  recipients: string[],
): Promise<SendInvitesResult | null> {
  const to = recipients.filter((r) => r && r !== organizer.email);
  if (to.length === 0) return null;

  let token = "";
  try {
    token = await getUserGmailToken(organizer.email);
  } catch {
    /* token lookup failed — sendInvites reports it as a no-grant outcome */
  }
  return sendInvites(organizer, token, place, to);
}
