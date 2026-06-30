import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  conversations,
  messages,
  projects,
  type MessageBlock,
} from "@/lib/db/schema";
import { MODELS, DEFAULT_MODEL, getModel } from "@/lib/claude/models";
import type { ModelOption } from "@/components/chat/chat-client";

export function modelOptions(): ModelOption[] {
  return MODELS.map((m) => ({
    id: m.id,
    label: m.label,
    blurb: m.blurb,
    enabled: m.enabled,
    efforts: m.efforts,
    adaptiveThinking: m.adaptiveThinking,
  }));
}

export function resolveDefaults(personalization?: {
  defaultModel?: string;
  defaultEffort?: string;
} | null): { model: string; effort: string } {
  let model = personalization?.defaultModel || DEFAULT_MODEL;
  if (!getModel(model)?.enabled) model = DEFAULT_MODEL;
  const effort = personalization?.defaultEffort || "high";
  return { model, effort };
}

export async function listConversations(userId: string) {
  return db
    .select({ id: conversations.id, title: conversations.title })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt))
    .limit(50);
}

export async function listProjects(userId: string) {
  return db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.ownerId, userId))
    .orderBy(desc(projects.createdAt));
}

export async function getConversationForUser(userId: string, id: string) {
  const conv = (
    await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
  )[0];
  if (!conv) return null;
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt);
  const msgs = rows.map((m) => {
    const blocks = m.blocks as MessageBlock[];
    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n");
    const thinking = blocks
      .filter((b) => b.type === "thinking")
      .map((b) => (b as { text: string }).text)
      .join("\n");
    const attachments = blocks
      .filter((b) => b.type === "image" || b.type === "document")
      .map((b) => {
        const x = b as { mime: string; name: string };
        return { name: x.name, mime: x.mime };
      });
    return { role: m.role, text, thinking, attachments };
  });
  return { conv, messages: msgs };
}
