// POST: log in with the shared passphrase -> set HMAC cookie.
// DELETE: log out -> clear cookie.
import { NextResponse } from "next/server";
import { AUTH_COOKIE, checkPassphrase, cookieOptions, expectedToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const passphrase = typeof body?.passphrase === "string" ? body.passphrase : "";

  if (!checkPassphrase(passphrase)) {
    // Fixed delay blunts brute-forcing (no accounts/lockout to manage).
    await new Promise((r) => setTimeout(r, 250));
    return NextResponse.json({ ok: false, error: "Invalid passphrase" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, expectedToken(), cookieOptions());
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  return res;
}
