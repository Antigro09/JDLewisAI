import { desc, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { skills, type Skill, type AppUser } from "@/lib/db/schema";

/** Skills a user can see: their personal skills + all org-wide skills. */
export async function listAvailableSkills(user: AppUser): Promise<Skill[]> {
  return db
    .select()
    .from(skills)
    .where(or(eq(skills.ownerId, user.id), eq(skills.scope, "org")))
    .orderBy(desc(skills.createdAt));
}

export async function defaultActiveSkillIds(user: AppUser): Promise<string[]> {
  const rows = await listAvailableSkills(user);
  return rows.filter((s) => s.defaultActive).map((s) => s.id);
}

/** Resolve which skills apply: explicit selection, or default-active set. */
export async function resolveActiveSkills(
  user: AppUser,
  skillIds: string[] | null,
): Promise<Skill[]> {
  const available = await listAvailableSkills(user);
  const ids = skillIds ?? available.filter((s) => s.defaultActive).map((s) => s.id);
  const set = new Set(ids);
  return available.filter((s) => set.has(s.id));
}

export function buildSkillsPrompt(
  skillsList: { name: string; instructions: string }[],
): string {
  if (!skillsList.length) return "";
  const parts = skillsList.map((s) => `### Skill: ${s.name}\n${s.instructions}`);
  let text =
    "Active skills — apply these company/user instruction packs to your work:\n\n" +
    parts.join("\n\n");
  if (text.length > 30_000) text = text.slice(0, 30_000) + "\n…[truncated]";
  return text;
}
