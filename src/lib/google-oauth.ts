// Google OAuth 2.0 (Authorization Code flow) helper. Server-only.
// We only use Google to *verify who the user is* (email + name). We do not
// request or store any Google API scopes beyond basic profile/email.
import { OAuth2Client } from "google-auth-library";

const SCOPES = ["openid", "email", "profile"];
// Where Google sends the user back. Must EXACTLY match an Authorized redirect
// URI in the OAuth client (scheme, host, path, no trailing slash).
export const CALLBACK_PATH = "/api/auth/google/callback";
// Short-lived cookie holding the CSRF `state` between start and callback.
export const OAUTH_STATE_COOKIE = "dsp_oauth_state";

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

// Resolve the absolute callback URL. Prefer APP_BASE_URL (set this in prod so
// it matches the registered redirect URI even behind a proxy); else derive from
// the incoming request's origin.
export function callbackUrl(req: Request): string {
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "") ?? new URL(req.url).origin;
  return `${base}${CALLBACK_PATH}`;
}

// Step 1: the Google consent-screen URL to redirect the user to.
export function authUrl(redirectUri: string, state: string): string {
  return oauthClient(redirectUri).generateAuthUrl({
    access_type: "online",
    scope: SCOPES,
    state,
    prompt: "select_account",
  });
}

export interface GoogleIdentity {
  email: string;
  name: string;
}

// Step 2: exchange the auth code for tokens and verify the ID token, returning
// the user's verified email + name. Throws if anything fails to verify.
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
  };
}
