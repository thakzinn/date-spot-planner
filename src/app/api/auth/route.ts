// DELETE: log out -> clear the session cookie.
// (Login is handled by the Google OAuth flow under /api/auth/google/*.)
import { NextResponse } from "next/server";
import { AUTH_COOKIE, cookieOptions } from "@/lib/auth";

export const runtime = "nodejs";

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  return res;
}
