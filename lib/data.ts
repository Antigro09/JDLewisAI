import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  conversations,
  projects,
  projectFiles,
  type AppUser,
  type Conversation,
  type MessageBlock,
} from "@/lib/db/schema";
import { MODELS, DEFAULT_MODEL, getModel } from "@/lib/claude/models";
import { buildSystemPrompt } from "@/lib/claude/system";
import { resolveActiveSkills, buildSkillsPrompt } from "@/lib/skills";
import { listMemories, buildMemoryPrompt } from "@/lib/memory";
import { buildActivePath, getSiblings } from "@/lib/chat/branches";
import type { ModelOption } from "@/components/chat/chat-client";

export function modelOptions(): ModelOption[] {
  return MODELS.map((m) => ({
    id: m.id,
    label: m.label,
    blurb: m.blurb,
    enabled: m.enabled,
    efforts: m.efforts,
    adaptiveThinking: m.adaptiveThinking,
    tier: m.tier ?? "primary",
  }));
}

export function resolveDefaults(personalization?: {
  defaultModel?: string;
  defaultEffort?: string;
} | null): { model: string; effort: string } {
  let model = personalization?.defaultModel || DEFAULT_MODEL;
  if (!getModel(model)?.enabled) model = DEFAULT_MODEL;
  const effort = personalization?.defaultEffort || "medium";
  return { model, effort };
}

export async function listConversations(userId: string) {
  return db
    .select({
      id: conversations.id,
      title: conversations.title,
      pinned: conversations.pinned,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, userId),
        isNull(conversations.automationId),
      ),
    )
    .orderBy(desc(conversations.pinned), desc(conversations.updatedAt))
    .limit(100);
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
  // Only the active branch — not every message ever sent in every branch.
  const rows = await buildActivePath(id, conv.activeLeafId);
  type Activity = { tool: string; summary: string; link?: string; isError?: boolean };
  type BranchInfo = { current: number; total: number; siblingIds: string[] };
  type DisplayMsg = {
    id: string;
    parentId: string | null;
    role: "user" | "assistant";
    text: string;
    thinking: string;
    attachments: { name: string; mime: string }[];
    activities: Activity[];
    branchInfo?: BranchInfo;
  };
  const msgs: DisplayMsg[] = [];
  for (const m of rows) {
    const blocks = m.blocks as MessageBlock[];
    const toolResults = blocks.filter((b) => b.type === "tool_result");
    // Synthetic tool-result turns: fold their activity into the prior assistant message.
    if (m.role === "user" && toolResults.length > 0) {
      const activities: Activity[] = toolResults.map((b) => {
        const x = b as {
          name: string;
          summary?: string;
          link?: string;
          isError?: boolean;
        };
        return { tool: x.name, summary: x.summary ?? x.name, link: x.link, isError: x.isError };
      });
      const last = msgs[msgs.length - 1];
      if (last && last.role === "assistant") last.activities.push(...activities);
      continue;
    }
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
    // Skip empty assistant placeholders (e.g. a turn that only made tool calls
    // with no preamble — its activity is folded in from the following turn).
    if (m.role === "assistant" && !text && !thinking) {
      msgs.push({
        id: m.id,
        parentId: m.parentId,
        role: "assistant",
        text: "",
        thinking: "",
        attachments: [],
        activities: [],
      });
      continue;
    }
    msgs.push({
      id: m.id,
      parentId: m.parentId,
      role: m.role,
      text,
      thinking,
      attachments,
      activities: [],
    });
  }

  // Branch navigation: only nodes with >1 sibling get a switcher.
  for (const m of msgs) {
    const siblings = await getSiblings(id, m.parentId);
    if (siblings.length > 1) {
      m.branchInfo = {
        current: siblings.findIndex((s) => s.id === m.id) + 1,
        total: siblings.length,
        siblingIds: siblings.map((s) => s.id),
      };
    }
  }

  return { conv, messages: msgs };
}

/** Build the system prompt for a conversation (personalization + project + Google). */
export async function buildChatSystem(
  user: AppUser,
  conv: Pick<Conversation, "projectId" | "skillIds">,
  googleEnabled: boolean,
): Promise<string> {
  let projectName: string | null = null;
  let projectInstructions: string | null = null;

  const activeSkills = await resolveActiveSkills(user, conv.skillIds ?? null);
  // Container-executed skills (uploaded to the Skills API) load their own
  // instructions inside the sandbox — only inject text-only packs here.
  const skillsPrompt = buildSkillsPrompt(
    activeSkills
      .filter((s) => !(s.execInContainer && s.anthropicSkillId))
      .map((s) => ({ name: s.name, instructions: s.instructions })),
  );

  const memoryPrompt = buildMemoryPrompt(await listMemories(user));

  if (conv.projectId) {
    const proj = (
      await db.select().from(projects).where(eq(projects.id, conv.projectId))
    )[0];
    if (proj) {
      projectName = proj.name;
      let extra = proj.instructions ? proj.instructions + "\n" : "";
      let budget = 50_000;
      const files = await db
        .select()
        .from(projectFiles)
        .where(eq(projectFiles.projectId, conv.projectId));
      for (const f of files) {
        if (f.mime.startsWith("text/") || f.mime === "application/json") {
          if (budget <= 0) break;
          let content = "";
          try {
            content = Buffer.from(f.data, "base64").toString("utf8");
          } catch {
            content = "";
          }
          const slice = content.slice(0, budget);
          budget -= slice.length;
          extra += `\n\n--- Project file: ${f.name} ---\n${slice}`;
        } else {
          extra += `\n\n[Project file available: ${f.name} (${f.mime})]`;
        }
      }
      projectInstructions = extra || null;
    }
  }

  return buildSystemPrompt({
    personalization: user.personalization,
    projectName,
    projectInstructions,
    googleEnabled,
    skillsPrompt,
    memoryPrompt,
  });
}
