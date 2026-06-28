// GET /api/auth/google/callback
// Google redirects here with ?code & ?state. We verify state (CSRF), exchange
// the code for a verified identity, check the email against the `users`
// allowlist, and only then issue a session cookie.
import { NextResponse } from "next/server";
import { AUTH_COOKIE, cookieOptions, signSession } from "@/lib/auth";
import { callbackUrl, exchangeCode, OAUTH_STATE_COOKIE } from "@/lib/google-oauth";
import { registerAndAuthorizeUser, setUserGmailToken } from "@/lib/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bounce back to the login page with a machine-readable reason.
function fail(req: Request, reason: string) {
  const url = new URL("/login", req.url);
  url.searchParams.set("error", reason);
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // The user may deny consent: Google returns ?error instead of ?code.
  if (url.searchParams.get("error")) return fail(req, "google_denied");
  if (!code || !state) return fail(req, "missing_code");

  const cookieState = req.headers
    .get("cookie")
    ?.match(new RegExp(`(?:^|;\\s*)${OAUTH_STATE_COOKIE}=([^;]+)`))?.[1];
  if (!cookieState || cookieState !== state) return fail(req, "bad_state");

  let identity;
  try {
    identity = await exchangeCode(callbackUrl(req), code);
  } catch {
    return fail(req, "exchange_failed");
  }

  let result;
  try {
    result = await registerAndAuthorizeUser(identity.email, identity.name);
  } catch {
    return fail(req, "lookup_failed");
  }
  if (result !== "active") return fail(req, "not_allowed");

  // Persist the Gmail refresh token so we can later send invites as this user.
  // Best-effort: a failure here must not block sign-in. Empty on repeat logins
  // (Google only reissues the token with prompt=consent) — setUserGmailToken
  // skips empties so a prior token isn't clobbered.
  if (identity.refreshToken) {
    try {
      await setUserGmailToken(identity.email, identity.refreshToken);
    } catch {
      /* token store failed — user can still sign in; invites just won't send */
    }
  }

  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set(
    AUTH_COOKIE,
    signSession({ email: identity.email, name: identity.name }),
    cookieOptions(),
  );
  res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
