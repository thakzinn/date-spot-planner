// POST   /api/push  { subscription, test? }  -> save the browser subscription
//   for the signed-in user; if `test` is true, immediately send a confirmation
//   push to all of that user's devices.
// DELETE /api/push  { endpoint }             -> remove one browser subscription.
//
// Serverless notes: web-push runs on the Node runtime (crypto); every push is a
// single short HTTPS call — no long-lived connections, well within the function
// timeout. maxDuration is capped low to fail fast if a push service hangs.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { savePushSubscription, deleteSubscriptionByEndpoint } from "@/lib/pushStore";
import { sendPushToUser } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}
function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

// A browser PushSubscription.toJSON(): { endpoint, keys: { p256dh, auth } }.
interface IncomingSub {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

function normalizeSub(sub: IncomingSub | undefined) {
  const endpoint = String(sub?.endpoint ?? "").trim();
  const p256dh = String(sub?.keys?.p256dh ?? "").trim();
  const auth = String(sub?.keys?.auth ?? "").trim();
  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, keys: { p256dh, auth } };
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  let body: { subscription?: IncomingSub; test?: boolean };
  try {
    body = await req.json();
  } catch {
    return bad("invalid JSON");
  }

  const sub = normalizeSub(body.subscription);
  if (!sub) return bad("missing or malformed subscription");

  const userAgent = req.headers.get("user-agent") ?? "";

  try {
    await savePushSubscription(session.email, sub, userAgent);

    if (body.test) {
      const result = await sendPushToUser(session.email, {
        title: "🔔 Notifications enabled",
        body: "You'll get reminders about your date plans here.",
        url: "/plans",
        tag: "welcome",
      });
      return NextResponse.json({ ok: true, tested: true, result }, { status: 201 });
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return bad(err instanceof Error ? err.message : String(err), 500);
  }
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  let body: { endpoint?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("invalid JSON");
  }
  const endpoint = String(body.endpoint ?? "").trim();
  if (!endpoint) return bad("endpoint is required");

  try {
    await deleteSubscriptionByEndpoint(endpoint);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return bad(err instanceof Error ? err.message : String(err), 500);
  }
}
