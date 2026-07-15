import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type AppUser } from "@/lib/db/schema";
import {
  SESSION_COOKIE,
  createSessionToken,
  verifySessionToken,
  sessionCookieOptions,
  type SessionClaims,
} from "./session";

export async function getSessionClaims(): Promise<SessionClaims | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function getCurrentUser(): Promise<AppUser | null> {
  const claims = await getSessionClaims();
  if (!claims) return null;
  const rows = await db.select().from(users).where(eq(users.id, claims.sub));
  const user = rows[0];
  if (!user || user.disabled) return null;
  // Session revocation: tokens minted before the last tokenVersion bump
  // (password change, role change, "sign out all devices") are rejected.
  if (claims.tv < user.tokenVersion) return null;
  return user;
}

export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<AppUser> {
  const user = await requireUser();
  // SUPERADMIN (the app owner) is a strict superset of ADMIN.
  if (user.role !== "ADMIN" && user.role !== "SUPERADMIN") redirect("/chat");
  return user;
}

export async function requireSuperadmin(): Promise<AppUser> {
  const user = await requireUser();
  if (user.role !== "SUPERADMIN") redirect("/chat");
  return user;
}

export async function setSession(user: AppUser): Promise<void> {
  const token = await createSessionToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tv: user.tokenVersion,
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions);
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
