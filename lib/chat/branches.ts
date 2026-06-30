import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  conversations,
  messages,
  type Message,
  type MessageBlock,
} from "@/lib/db/schema";

/** Rendered thread for the active branch: walk parentId from the leaf to the
 * root. Falls back to full chronological order when there's no leaf yet
 * (empty conversation — degenerates to the same empty result either way). */
export async function buildActivePath(
  conversationId: string,
  activeLeafId: string | null,
): Promise<Message[]> {
  if (!activeLeafId) {
    return db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));
  }
  const path: Message[] = [];
  let cursorId: string | null = activeLeafId;
  while (cursorId) {
    const row: Message | undefined = (
      await db.select().from(messages).where(eq(messages.id, cursorId))
    )[0];
    if (!row) break;
    path.push(row);
    cursorId = row.parentId;
  }
  return path.reverse();
}

/** Sibling messages sharing the same parent (branch alternatives), oldest first. */
export async function getSiblings(
  conversationId: string,
  parentId: string | null,
): Promise<Message[]> {
  const where = parentId
    ? and(eq(messages.conversationId, conversationId), eq(messages.parentId, parentId))
    : and(eq(messages.conversationId, conversationId), isNull(messages.parentId));
  return db.select().from(messages).where(where).orderBy(asc(messages.createdAt));
}

/** Walks forward from a message, always following its most-recently-created
 * child, until a leaf (no children) is reached. */
export async function deepestLeaf(messageId: string): Promise<string> {
  let cursor = messageId;
  for (;;) {
    const children = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.parentId, cursor))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    if (children.length === 0) return cursor;
    cursor = children[0].id;
  }
}

/** Insert a message as the new tip of the conversation's active branch, and
 * advance `conversations.activeLeafId` to point at it. Centralizing this
 * keeps every insert site branch-consistent — none of them mutate
 * `messages`/`activeLeafId` directly. */
export async function appendMessage(opts: {
  conversationId: string;
  role: "user" | "assistant";
  blocks: MessageBlock[];
  rawContent?: unknown[] | null;
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  /** Override the parent instead of using the conversation's current tip
   * (used when editing: the new message is a sibling of the edited one). */
  parentId?: string | null;
}): Promise<{ id: string }> {
  let parentId = opts.parentId;
  if (parentId === undefined) {
    const conv = (
      await db
        .select({ activeLeafId: conversations.activeLeafId })
        .from(conversations)
        .where(eq(conversations.id, opts.conversationId))
    )[0];
    parentId = conv?.activeLeafId ?? null;
  }

  const inserted = await db
    .insert(messages)
    .values({
      conversationId: opts.conversationId,
      parentId,
      role: opts.role,
      blocks: opts.blocks,
      rawContent: opts.rawContent ?? null,
      model: opts.model ?? null,
      inputTokens: opts.inputTokens ?? 0,
      outputTokens: opts.outputTokens ?? 0,
    })
    .returning({ id: messages.id });
  const id = inserted[0].id;

  await db
    .update(conversations)
    .set({ activeLeafId: id })
    .where(eq(conversations.id, opts.conversationId));

  return { id };
}
