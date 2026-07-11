// POST /api/push/test — send a test notification to every device the signed-in
// user has enabled. Used by the "ส่งทดสอบ" button in the sidebar. Returns 409 if
// the user has no active subscription yet (they need to enable notifications).
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sendPushToUser } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendPushToUser(session.email, {
      title: "🔔 ทดสอบการแจ้งเตือน",
      body: "ถ้าเห็นข้อความนี้ แสดงว่าการแจ้งเตือนทำงานเรียบร้อยแล้ว 🎉",
      url: "/plans",
      tag: "test",
    });

    if (result.sent === 0) {
      return NextResponse.json(
        { ok: false, error: "no_subscription", result },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
