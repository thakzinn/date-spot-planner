// GET /api/auth/google/start
// Kicks off Google sign-in: set a short-lived CSRF `state` cookie, then redirect
// to Google's consent screen.
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authUrl, callbackUrl, OAUTH_STATE_COOKIE } from "@/lib/google-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const state = randomBytes(16).toString("hex");
  const redirectUri = callbackUrl(req);

  const res = NextResponse.redirect(authUrl(redirectUri, state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10, // 10 minutes to complete the round-trip
  });
  return res;
}
