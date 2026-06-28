// GET /api/auth/google/start
// Kicks off Google sign-in: set a short-lived CSRF `state` cookie, then redirect
// to Google's consent screen.
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import {
  authUrl,
  callbackUrl,
  OAUTH_STATE_COOKIE,
  OAUTH_NEXT_COOKIE,
  safeNextPath,
} from "@/lib/google-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const state = randomBytes(16).toString("hex");
  const redirectUri = callbackUrl(req);
  // Remember where to send the user after login (e.g. a /visit/<id> check-in).
  const next = safeNextPath(new URL(req.url).searchParams.get("next"));

  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 10, // 10 minutes to complete the round-trip
  };

  const res = NextResponse.redirect(authUrl(redirectUri, state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, cookieOpts);
  res.cookies.set(OAUTH_NEXT_COOKIE, next, cookieOpts);
  return res;
}
