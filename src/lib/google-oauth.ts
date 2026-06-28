// Google OAuth 2.0 (Authorization Code flow) helper. Server-only.
// We use Google to verify who the user is (email + name) AND to obtain a
// gmail.send grant so the app can email date invites "as" the signed-in user.
// The resulting refresh token is stored per-user in the `users` sheet.
import { OAuth2Client } from "google-auth-library";

// gmail.send lets us send mail on the user's behalf but NOT read their mailbox.
// It is a "sensitive" scope: testers see an "unverified app" screen while the
// OAuth app stays in Testing — fine for a private app (see SETUP.md Part C2).
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const SCOPES = ["openid", "email", "profile", GMAIL_SEND_SCOPE];
// Where Google sends the user back. Must EXACTLY match an Authorized redirect
// URI in the OAuth client (scheme, host, path, no trailing slash).
export const CALLBACK_PATH = "/api/auth/google/callback";
// Short-lived cookie holding the CSRF `state` between start and callback.
export const OAUTH_STATE_COOKIE = "dsp_oauth_state";
// Short-lived cookie holding the post-login destination across the round-trip.
export const OAUTH_NEXT_COOKIE = "dsp_oauth_next";

// Sanitize a post-login redirect target to an internal path. Only same-origin
// absolute paths are allowed ("/visit/abc") — anything else (full URLs,
// protocol-relative "//evil.com", empty) falls back to "/" to prevent an open
// redirect.
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// Build a one-shot client bound to the absolute redirect URI for this request.
export function oauthClient(redirectUri: string): OAuth2Client {
  return new OAuth2Client({
    clientId: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirectUri,
  });
}

// Build a client primed with a stored refresh token. It transparently mints a
// fresh access token on the next API call — used to send mail as the user.
export function refreshTokenClient(refreshToken: string): OAuth2Client {
  const client = new OAuth2Client({
    clientId: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
  });
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

// Resolve the absolute callback URL. Prefer APP_BASE_URL (set this in prod so
// it matches the registered redirect URI even behind a proxy); else derive from
// the incoming request's origin.
export function callbackUrl(req: Request): string {
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "") ?? new URL(req.url).origin;
  return `${base}${CALLBACK_PATH}`;
}

// Step 1: the Google consent-screen URL to redirect the user to.
// access_type "offline" + prompt "consent" forces Google to return a refresh
// token (it only does so on explicit consent), which we need to send mail later.
export function authUrl(redirectUri: string, state: string): string {
  return oauthClient(redirectUri).generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    state,
    prompt: "consent select_account",
  });
}

export interface GoogleIdentity {
  email: string;
  name: string;
  // Long-lived Gmail refresh token. Present only on first offline consent;
  // empty on later sign-ins (Google reissues it only with prompt=consent).
  refreshToken: string;
}

// Step 2: exchange the auth code for tokens and verify the ID token, returning
// the user's verified email + name + (if granted) Gmail refresh token. Throws if
// anything fails to verify.
export async function exchangeCode(redirectUri: string, code: string): Promise<GoogleIdentity> {
  const client = oauthClient(redirectUri);
  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) throw new Error("No id_token in Google token response");

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
  });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) {
    throw new Error("Google account has no verified email");
  }
  return {
    email: payload.email.toLowerCase(),
    name: payload.name ?? payload.email,
    refreshToken: tokens.refresh_token ?? "",
  };
}
