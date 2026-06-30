"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { googleAccounts, skills, skillFiles } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";
import { PLUGINS, setUserPlugin } from "@/lib/plugins";
import { parseSkillMd } from "@/lib/skills/parse-skill-md";

export async function disconnectGoogle() {
  const user = await requireUser();
  await db.delete(googleAccounts).where(eq(googleAccounts.userId, user.id));
  revalidatePath("/customize");
}

export async function savePluginPrefs(formData: FormData) {
  const user = await requireUser();
  for (const p of PLUGINS) {
    await setUserPlugin(user.id, p.id, formData.get(`plugin_${p.id}`) === "on");
  }
  revalidatePath("/customize");
}

const MAX_REFERENCE_BYTES = 5 * 1024 * 1024;

export type SkillUploadState = { error?: string };

export async function createSkillFromMarkdown(
  _prev: SkillUploadState,
  formData: FormData,
): Promise<SkillUploadState> {
  const user = await requireUser();
  const file = formData.get("skillMd");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a SKILL.md file." };
  }
  if (file.size > MAX_REFERENCE_BYTES) {
    return { error: "SKILL.md exceeds 5 MB." };
  }

  let parsed;
  let rawText: string;
  try {
    rawText = await file.text();
    parsed = parseSkillMd(rawText);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not parse SKILL.md." };
  }

  const nameOverride = String(formData.get("name") ?? "").trim();
  const descriptionOverride = String(formData.get("description") ?? "").trim();
  const defaultActive = formData.get("defaultActive") === "on";
  const scope =
    user.role === "ADMIN" && formData.get("scope") === "org" ? "org" : "personal";

  const referenceFiles = formData
    .getAll("referenceFiles")
    .filter((f): f is File => f instanceof File && f.size > 0);
  for (const f of referenceFiles) {
    if (f.size > MAX_REFERENCE_BYTES) {
      return { error: `"${f.name}" exceeds 5 MB.` };
    }
  }

  let skillId: string;
  try {
    const inserted = await db
      .insert(skills)
      .values({
        ownerId: user.id,
        scope,
        name: nameOverride || parsed.name,
        description: descriptionOverride || parsed.description || null,
        instructions: parsed.instructions,
        defaultActive,
      })
      .returning();
    skillId = inserted[0].id;

    await db.insert(skillFiles).values({
      skillId,
      name: file.name || "SKILL.md",
      mime: "text/markdown",
      data: Buffer.from(rawText, "utf8").toString("base64"),
      kind: "primary",
    });

    for (const f of referenceFiles) {
      const data = Buffer.from(await f.arrayBuffer()).toString("base64");
      await db.insert(skillFiles).values({
        skillId,
        name: f.name,
        mime: f.type || "application/octet-stream",
        data,
        kind: "reference",
      });
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save skill." };
  }

  redirect("/customize?tab=skills");
}
