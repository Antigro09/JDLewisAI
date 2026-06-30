"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type Personalization } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";

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
