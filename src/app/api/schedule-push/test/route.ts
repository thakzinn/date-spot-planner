// POST /api/schedule-push/test — schedule a reminder to the signed-in user a
// short delay from now (default 2 min), to verify the durable-sleep path
// end-to-end on a deployed environment. Enable notifications first (the sidebar
// toggle), then hit this and wait — the push should fire even with the site
// closed. Distinct from /api/push/test, which sends immediately.
//
// Body (optional): { seconds?: number } — how far out to schedule (10..3600).
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { scheduleReminder } from "@/lib/scheduleReminder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const raw = Number((body as { seconds?: unknown }).seconds ?? 120);
  const seconds = Number.isFinite(raw) ? Math.min(3600, Math.max(10, raw)) : 120;
  const dueTimestamp = Date.now() + seconds * 1000;

  try {
    const result = await scheduleReminder({
      email: session.email,
      taskId: `test-${session.email}-${dueTimestamp}`,
      dueTimestamp,
      payload: {
        title: "⏰ ทดสอบการเตือนตามเวลา",
        body: `ตั้งเวลาไว้เมื่อ ${seconds} วินาทีที่แล้ว — ถ้าเห็นข้อความนี้แสดงว่า Workflow ทำงาน 🎉`,
        url: "/plans",
        tag: "schedule-test",
      },
    });

    if (!result.scheduled) {
      return NextResponse.json({ ok: false, error: result.reason ?? "not scheduled" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, firesInSeconds: seconds, ...result });
  } catch (err) {
    // Surfaces "QSTASH_TOKEN is not set" etc. so misconfig is obvious in testing.
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
