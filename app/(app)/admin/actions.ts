"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, documentTemplates, type Role } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/server";
import { PLUGINS, setOrgPlugin } from "@/lib/plugins";
import { getOrgTemplate } from "@/lib/templates/render";

export async function setUserRole(userId: string, role: Role) {
  const admin = await requireAdmin();
  if (admin.id === userId) return; // don't change your own role (avoid lockout)
  await db.update(users).set({ role }).where(eq(users.id, userId));
  revalidatePath("/admin");
}

export async function setUserDisabled(userId: string, disabled: boolean) {
  const admin = await requireAdmin();
  if (admin.id === userId) return; // can't disable yourself
  await db.update(users).set({ disabled }).where(eq(users.id, userId));
  revalidatePath("/admin");
}

export async function deleteUser(userId: string) {
  const admin = await requireAdmin();
  if (admin.id === userId) return; // can't delete yourself
  await db.delete(users).where(eq(users.id, userId));
  revalidatePath("/admin");
}

export async function saveOrgPluginDefaults(formData: FormData) {
  await requireAdmin();
  for (const p of PLUGINS) {
    await setOrgPlugin(p.id, formData.get(`plugin_${p.id}`) === "on");
  }
  revalidatePath("/admin");
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export async function saveDocumentTemplate(formData: FormData) {
  await requireAdmin();
  const existing = await getOrgTemplate();

  let logo = existing?.logo ?? null;
  const file = formData.get("logo");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_LOGO_BYTES) throw new Error("Logo exceeds 2 MB.");
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    logo = `data:${file.type || "image/png"};base64,${base64}`;
  }

  const values = {
    kind: "general" as const,
    name: String(formData.get("name") ?? "").trim() || "Company branding",
    logo,
    headerText: String(formData.get("headerText") ?? "").trim() || null,
    footerText: String(formData.get("footerText") ?? "").trim() || null,
    brandColor: String(formData.get("brandColor") ?? "").trim() || null,
    updatedAt: new Date(),
  };

  if (existing) {
    await db
      .update(documentTemplates)
      .set(values)
      .where(eq(documentTemplates.id, existing.id));
  } else {
    await db.insert(documentTemplates).values(values);
  }
  revalidatePath("/admin");
}
