"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  hashPassword,
  verifyPassword,
  passwordPolicyError,
  MIN_PASSWORD_LENGTH,
} from "@/lib/auth/password";
import { setSession, clearSession } from "@/lib/auth/server";
import {
  checkRateLimit,
  resetRateLimit,
  getClientIp,
} from "@/lib/rate-limit";

export type AuthState = { error?: string };

const signInSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

const signUpSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
});

const AUTH_ATTEMPT_LIMIT = { limit: 10, windowSeconds: 15 * 60 };
// Per-email failures get a larger budget so a third party spraying wrong
// passwords at someone's address can't cheaply lock them out — and a correct
// password always succeeds regardless (see signInAction), so it never can.
const EMAIL_FAILURE_LIMIT = { limit: 50, windowSeconds: 15 * 60 };
const TOO_MANY_ATTEMPTS = "Too many attempts — try again later.";

/** Per-IP volume brake (increments on every attempt). */
async function ipRateLimited(scope: string): Promise<boolean> {
  const ip = await getClientIp();
  const { allowed } = await checkRateLimit(`${scope}-ip`, ip, AUTH_ATTEMPT_LIMIT);
  return !allowed;
}

function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === "string" ? next : "/chat";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/chat";
}

export async function signInAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const email = parsed.data.email.toLowerCase();

  // Per-IP brake catches a single source hammering many accounts. The per-email
  // counter tracks FAILURES only and never gates a correct password, so it slows
  // distributed guessing without letting anyone lock a victim out of their own
  // account (the classic per-email rate-limit DoS).
  if (await ipRateLimited("signin")) {
    return { error: TOO_MANY_ATTEMPTS };
  }
  const emailFailures = await checkRateLimit(
    "signin-email",
    email,
    EMAIL_FAILURE_LIMIT,
    { peek: true },
  );

  let ok = false;
  try {
    const rows = await db.select().from(users).where(eq(users.email, email));
    const user = rows[0];
    const valid =
      user &&
      !user.disabled &&
      (await verifyPassword(parsed.data.password, user.passwordHash));
    if (!valid) {
      // Count the failure; a flood of wrong guesses eventually trips the brake,
      // but the real owner's correct password below is never blocked.
      await checkRateLimit("signin-email", email, EMAIL_FAILURE_LIMIT);
      if (!emailFailures.allowed) return { error: TOO_MANY_ATTEMPTS };
      return { error: "Invalid email or password" };
    }
    await resetRateLimit("signin-email", email);
    await setSession(user);
    ok = true;
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
  if (ok) redirect(safeNext(formData.get("next")));
  return {};
}

export async function signUpAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const name = String(formData.get("name") ?? "").trim();
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!name) return { error: "Enter your name" };
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const email = parsed.data.email.toLowerCase();

  const policyError = passwordPolicyError(parsed.data.password, email);
  if (policyError) return { error: policyError };

  if (await ipRateLimited("signup")) {
    return { error: TOO_MANY_ATTEMPTS };
  }

  const allowedDomain = process.env.ALLOWED_SIGNUP_DOMAIN?.trim();
  if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) {
    return { error: `Sign-up is restricted to @${allowedDomain} emails.` };
  }

  let ok = false;
  try {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    if (existing[0]) return { error: "An account with that email already exists." };

    const inserted = await db
      .insert(users)
      .values({
        email,
        name,
        passwordHash: await hashPassword(parsed.data.password),
        role: "MEMBER",
      })
      .returning();
    await setSession(inserted[0]);
    ok = true;
  } catch {
    return { error: "Could not create account. Please try again." };
  }
  if (ok) redirect(safeNext(formData.get("next")));
  return {};
}

export async function signOutAction(): Promise<void> {
  await clearSession();
  redirect("/login");
}
