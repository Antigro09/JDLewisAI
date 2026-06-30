"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, googleAccounts, type Personalization } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";
import { PLUGINS, setUserPlugin } from "@/lib/plugins";

export async function updatePersonalization(formData: FormData) {
  const user = await requireUser();
  const personalization: Personalization = {
    displayRole: String(formData.get("displayRole") ?? "").trim() || undefined,
    about: String(formData.get("about") ?? "").trim() || undefined,
    tone: String(formData.get("tone") ?? "").trim() || undefined,
    defaultModel: String(formData.get("defaultModel") ?? "").trim() || undefined,
    defaultEffort: String(formData.get("defaultEffort") ?? "").trim() || undefined,
  };
  await db
    .update(users)
    .set({ personalization })
    .where(eq(users.id, user.id));
  revalidatePath("/settings");
}

export async function disconnectGoogle() {
  const user = await requireUser();
  await db.delete(googleAccounts).where(eq(googleAccounts.userId, user.id));
  revalidatePath("/settings");
}

export async function savePluginPrefs(formData: FormData) {
  const user = await requireUser();
  for (const p of PLUGINS) {
    await setUserPlugin(user.id, p.id, formData.get(`plugin_${p.id}`) === "on");
  }
  revalidatePath("/settings");
}
