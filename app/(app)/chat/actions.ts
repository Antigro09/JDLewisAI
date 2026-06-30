"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";

async function ownedConversation(userId: string, id: string) {
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
  return Boolean(rows[0]);
}

export async function renameConversation(id: string, title: string) {
  const user = await requireUser();
  const trimmed = title.trim();
  if (!trimmed) return { error: "Title can't be empty." };
  if (!(await ownedConversation(user.id, id))) return { error: "Not found." };
  await db
    .update(conversations)
    .set({ title: trimmed.slice(0, 200), updatedAt: new Date() })
    .where(eq(conversations.id, id));
  return { ok: true };
}

export async function toggleConversationPinned(id: string, pinned: boolean) {
  const user = await requireUser();
  if (!(await ownedConversation(user.id, id))) return { error: "Not found." };
  await db.update(conversations).set({ pinned }).where(eq(conversations.id, id));
  return { ok: true };
}

export async function deleteConversation(id: string) {
  const user = await requireUser();
  if (!(await ownedConversation(user.id, id))) return { error: "Not found." };
  await db.delete(conversations).where(eq(conversations.id, id));
  return { ok: true };
}
