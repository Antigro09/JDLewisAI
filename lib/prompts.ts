import { and, desc, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { prompts, type Prompt, type AppUser } from "@/lib/db/schema";

/** Prompts a user can see: their personal prompts + all org-wide prompts. */
export async function listPrompts(user: AppUser): Promise<Prompt[]> {
  return db
    .select()
    .from(prompts)
    .where(or(eq(prompts.ownerId, user.id), eq(prompts.scope, "org")))
    .orderBy(desc(prompts.createdAt));
}

export async function createPrompt(opts: {
  ownerId: string;
  scope: "personal" | "org";
  title: string;
  body: string;
}): Promise<void> {
  await db.insert(prompts).values(opts);
}

export async function deletePrompt(userId: string, id: string): Promise<void> {
  await db
    .delete(prompts)
    .where(and(eq(prompts.id, id), eq(prompts.ownerId, userId)));
}
