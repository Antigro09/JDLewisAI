"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { skills, type Skill, type AppUser } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";

function canEdit(user: AppUser, skill: Skill): boolean {
  return (
    skill.ownerId === user.id ||
    (user.role === "ADMIN" && skill.scope === "org")
  );
}

export async function createSkill(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const instructions = String(formData.get("instructions") ?? "").trim();
  if (!name || !instructions) return;
  const scope =
    user.role === "ADMIN" && formData.get("scope") === "org"
      ? "org"
      : "personal";
  await db.insert(skills).values({
    ownerId: user.id,
    scope,
    name,
    description: String(formData.get("description") ?? "").trim() || null,
    instructions,
    defaultActive: formData.get("defaultActive") === "on",
  });
  redirect("/skills");
}

export async function updateSkill(id: string, formData: FormData) {
  const user = await requireUser();
  const skill = (await db.select().from(skills).where(eq(skills.id, id)))[0];
  if (!skill || !canEdit(user, skill)) throw new Error("Not found");
  const scope =
    user.role === "ADMIN" && formData.get("scope") === "org"
      ? "org"
      : skill.scope;
  await db
    .update(skills)
    .set({
      name: String(formData.get("name") ?? "").trim() || skill.name,
      description: String(formData.get("description") ?? "").trim() || null,
      instructions:
        String(formData.get("instructions") ?? "").trim() || skill.instructions,
      defaultActive: formData.get("defaultActive") === "on",
      scope,
    })
    .where(eq(skills.id, id));
  revalidatePath(`/skills/${id}`);
  revalidatePath("/skills");
}

export async function deleteSkill(id: string) {
  const user = await requireUser();
  const skill = (await db.select().from(skills).where(eq(skills.id, id)))[0];
  if (!skill || !canEdit(user, skill)) throw new Error("Not found");
  await db.delete(skills).where(eq(skills.id, id));
  redirect("/skills");
}
