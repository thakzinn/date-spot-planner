// Shared-passphrase auth for two users. The cookie holds an HMAC token derived
// from SHARED_PASSPHRASE — never the passphrase itself. Server-only.
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

function passphrase(): string {
  const p = process.env.SHARED_PASSPHRASE;
  if (!p) throw new Error("Missing SHARED_PASSPHRASE");
  return p;
}

// The opaque token stored in the cookie.
export function expectedToken(): string {
  return createHmac("sha256", passphrase()).update("dsp-auth-v1").digest("hex");
}

// Login check: does the submitted passphrase match SHARED_PASSPHRASE?
export function checkPassphrase(submitted: string): boolean {
  return safeEqual(submitted ?? "", passphrase());
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

// True if the current request carries a valid auth cookie.
export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE)?.value ?? "";
  if (!token) return false;
  try {
    return safeEqual(token, expectedToken());
  } catch {
    return false;
  }
}
