// Session auth for Google-SSO'd users. The cookie holds a signed payload
// { email, name } — identity comes from Google, the cookie just proves we
// already verified it. No passwords or Google tokens are ever stored.
// Server-only.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const AUTH_COOKIE = "dsp_auth";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

function sha256(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

// Constant-time string compare. Hashing both sides to a fixed length avoids the
// length-mismatch throw from timingSafeEqual and doesn't leak length.
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("Missing SESSION_SECRET");
  return s;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export interface SessionUser {
  email: string;
  name: string;
}

// Sign a session payload into an opaque "<payload>.<hmac>" token.
export function signSession(user: SessionUser): string {
  const payload = b64url(Buffer.from(JSON.stringify(user), "utf8"));
  const sig = b64url(createHmac("sha256", sessionSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}

// Verify a token's signature and return its user, or null if invalid/tampered.
export function verifySession(token: string): SessionUser | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(createHmac("sha256", sessionSecret()).update(payload).digest());
  try {
    if (!safeEqual(sig, expected)) return null;
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof obj?.email !== "string" || typeof obj?.name !== "string") return null;
    return { email: obj.email, name: obj.name };
  } catch {
    return null;
  }
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };
}

// The signed-in user for the current request, or null.
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE)?.value ?? "";
  if (!token) return null;
  try {
    return verifySession(token);
  } catch {
    return null;
  }
}

// True if the current request carries a valid session cookie.
export async function isAuthenticated(): Promise<boolean> {
  return (await getSession()) !== null;
}
