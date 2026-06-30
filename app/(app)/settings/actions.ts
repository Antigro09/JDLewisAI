"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type Personalization } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

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
  if (next.length < 8) {
    return { error: "New password must be at least 8 characters." };
  }
  if (next !== confirm) {
    return { error: "New password and confirmation don't match." };
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(users.id, user.id));
  revalidatePath("/settings");
  return { success: true };
}
