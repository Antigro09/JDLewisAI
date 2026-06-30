"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { setSession, clearSession } from "@/lib/auth/server";

export type AuthState = { error?: string };

const credentials = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === "string" ? next : "/chat";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/chat";
}

export async function signInAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  let ok = false;
  try {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, parsed.data.email.toLowerCase()));
    const user = rows[0];
    if (!user || user.disabled) return { error: "Invalid email or password" };
    if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
      return { error: "Invalid email or password" };
    }
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
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!name) return { error: "Enter your name" };
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const email = parsed.data.email.toLowerCase();

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
