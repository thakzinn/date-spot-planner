// Server-side Web Push sender. Wraps the `web-push` library: configures VAPID
// once per warm process and pushes an encrypted payload to a browser endpoint.
// Depends on Node crypto, so any route importing this MUST run on the Node.js
// runtime (not Edge). Server-only.
import webpush from "web-push";
import { requireEnv } from "./sheetsCore";
import {
  deleteSubscriptionByEndpoint,
  getSubscriptionsForUser,
  type PushSubscriptionRecord,
} from "./pushStore";

// setVapidDetails mutates global state; guard so warm invocations don't redo it.
let configured = false;
function configure(): void {
  if (configured) return;
  webpush.setVapidDetails(
    requireEnv("VAPID_SUBJECT"), // "mailto:you@example.com" or an https: URL
    requireEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
    requireEnv("VAPID_PRIVATE_KEY"),
  );
  configured = true;
}

// The JSON the service worker's `push` listener expects (see public/sw.js).
export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export interface PushResult {
  sent: number;
  pruned: number; // dead endpoints (404/410) removed from the store
  failed: number;
}

// A dead subscription: the browser unsubscribed or the endpoint expired. The
// push service signals this with 404 (Not Found) or 410 (Gone).
function isGone(err: unknown): boolean {
  const code = (err as { statusCode?: number }).statusCode;
  return code === 404 || code === 410;
}

// Push to a single endpoint. Returns "sent" | "gone" | "error" — never throws,
// so a bad endpoint can't abort a fan-out.
async function sendOne(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: PushPayload,
): Promise<"sent" | "gone" | "error"> {
  configure();
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      JSON.stringify(payload),
      { TTL: 60 }, // seconds the push service may buffer an undelivered message
    );
    return "sent";
  } catch (err) {
    if (isGone(err)) return "gone";
    console.error("[push] send failed", (err as { statusCode?: number }).statusCode, err);
    return "error";
  }
}

// Push to every device a user has enabled. Fans out concurrently (each send is
// one short HTTPS call — safe within a serverless timeout) and prunes any dead
// endpoints in the same pass so we don't keep retrying them.
export async function sendPushToUser(
  email: string,
  payload: PushPayload,
): Promise<PushResult> {
  const subs = await getSubscriptionsForUser(email);
  const result: PushResult = { sent: 0, pruned: 0, failed: 0 };
  if (subs.length === 0) return result;

  const outcomes = await Promise.all(subs.map((s) => sendOne(s, payload).then((r) => ({ s, r }))));

  const dead: PushSubscriptionRecord[] = [];
  for (const { s, r } of outcomes) {
    if (r === "sent") result.sent++;
    else if (r === "gone") dead.push(s);
    else result.failed++;
  }

  // Prune dead endpoints (sequential — this is off the response's critical path
  // for the common case where nothing is dead).
  for (const d of dead) {
    await deleteSubscriptionByEndpoint(d.endpoint);
    result.pruned++;
  }

  return result;
}
