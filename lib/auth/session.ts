import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";

export const SESSION_COOKIE = "session";
const ALG = "HS256";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export type SessionClaims = {
  sub: string;
  email: string;
  name: string;
  role: "ADMIN" | "MEMBER";
  // users.tokenVersion at mint time. Verification stays stateless; the
  // server-side user lookup rejects sessions whose tv is behind the DB.
  tv: number;
};

function secret(): Uint8Array {
  return new TextEncoder().encode(env.AUTH_SECRET);
}

export async function createSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT(claims as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || !payload.email || !payload.role) return null;
    return {
      sub: String(payload.sub),
      email: String(payload.email),
      name: String(payload.name ?? ""),
      role: payload.role === "ADMIN" ? "ADMIN" : "MEMBER",
      // Missing claim = pre-tokenVersion session; treat as 0 so existing
      // sessions keep working until the user's version is bumped.
      tv: typeof payload.tv === "number" ? payload.tv : 0,
    };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure:
    process.env.NODE_ENV === "production" &&
    process.env.DISABLE_SECURE_COOKIES !== "true",
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};
