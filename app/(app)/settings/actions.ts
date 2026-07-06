"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type Personalization } from "@/lib/db/schema";
import { requireUser, setSession } from "@/lib/auth/server";
import {
  hashPassword,
  verifyPassword,
  passwordPolicyError,
} from "@/lib/auth/password";

export async function updatePersonalization(formData: FormData) {
  const user = await requireUser();
  const prev = user.personalization ?? {};
  const darkModeRaw = String(formData.get("darkMode") ?? "");
  const personalization: Personalization = {
    displayRole: String(formData.get("displayRole") ?? "").trim() || undefined,
    about: String(formData.get("about") ?? "").trim() || undefined,
    tone: String(formData.get("tone") ?? "").trim() || undefined,
    defaultModel: String(formData.get("defaultModel") ?? "").trim() || undefined,
    defaultEffort: String(formData.get("defaultEffort") ?? "").trim() || undefined,
    darkMode:
      darkModeRaw === "light" || darkModeRaw === "dark" || darkModeRaw === "system"
        ? darkModeRaw
        : prev.darkMode,
    emailNotifications: formData.get("emailNotifications") === "on",
  };
  await db
    .update(users)
    .set({ personalization })
    .where(eq(users.id, user.id));
  revalidatePath("/settings");
}

export type ChangePasswordState = { error?: string; success?: boolean };

export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await requireUser();
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (!(await verifyPassword(current, user.passwordHash))) {
    return { error: "Current password is incorrect." };
  }
  const policyError = passwordPolicyError(next, user.email);
  if (policyError) return { error: policyError };
  if (next !== confirm) {
    return { error: "New password and confirmation don't match." };
  }

  // Bumping tokenVersion revokes every outstanding session; re-minting the
  // cookie keeps THIS device signed in with the new version.
  const [updated] = await db
    .update(users)
    .set({
      passwordHash: await hashPassword(next),
      tokenVersion: sql`${users.tokenVersion} + 1`,
    })
    .where(eq(users.id, user.id))
    .returning();
  await setSession(updated);
  revalidatePath("/settings");
  return { success: true };
}

export async function signOutAllDevicesAction() {
  const user = await requireUser();
  const [updated] = await db
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, user.id))
    .returning();
  // Re-mint this device's cookie so the caller stays signed in.
  await setSession(updated);
  revalidatePath("/settings");
}
