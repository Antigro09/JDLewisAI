"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";
import { deepestLeaf, getSiblings } from "@/lib/chat/branches";

async function ownedConversation(userId: string, conversationId: string) {
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
  return rows[0] ?? null;
}

/** Pure pointer move — switches the active branch to the one containing
 * `branchMessageId`, extending to that branch's current tip. No generation. */
export async function switchBranch(conversationId: string, branchMessageId: string) {
  const user = await requireUser();
  const conv = await ownedConversation(user.id, conversationId);
  if (!conv) return { error: "Not found." };

  const branchMsg = (
    await db.select().from(messages).where(eq(messages.id, branchMessageId))
  )[0];
  if (!branchMsg || branchMsg.conversationId !== conversationId) {
    return { error: "Not found." };
  }

  const leaf = await deepestLeaf(branchMessageId);
  await db
    .update(conversations)
    .set({ activeLeafId: leaf })
    .where(eq(conversations.id, conversationId));
  return { ok: true };
}

/** Deletes a message and its entire descendant subtree (DB cascade), then
 * recomputes the active leaf: a remaining sibling's deepest tip, else the
 * parent, else null (empty conversation). */
export async function deleteMessage(conversationId: string, messageId: string) {
  const user = await requireUser();
  const conv = await ownedConversation(user.id, conversationId);
  if (!conv) return { error: "Not found." };

  const target = (
    await db.select().from(messages).where(eq(messages.id, messageId))
  )[0];
  if (!target || target.conversationId !== conversationId) {
    return { error: "Not found." };
  }
  const parentId = target.parentId;

  await db.delete(messages).where(eq(messages.id, messageId));

  const siblings = await getSiblings(conversationId, parentId);
  let nextActiveLeafId: string | null;
  if (siblings.length > 0) {
    const mostRecent = siblings[siblings.length - 1];
    nextActiveLeafId = await deepestLeaf(mostRecent.id);
  } else {
    nextActiveLeafId = parentId;
  }

  await db
    .update(conversations)
    .set({ activeLeafId: nextActiveLeafId })
    .where(eq(conversations.id, conversationId));
  return { ok: true };
}
