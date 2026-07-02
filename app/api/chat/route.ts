import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, type MessageBlock } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/server";
import { applyPendingDecisions } from "@/lib/claude/agent";
import type { Attachment } from "@/lib/claude/types";
import { resolveModel } from "@/lib/claude/models";
import { isGoogleConnected } from "@/lib/google/client";
import { effectivePlugins } from "@/lib/plugins";
import { buildChatSystem } from "@/lib/data";
import { truncate } from "@/lib/utils";
import {
  RESEARCH_MODE_NOTE,
  SELF_CHECK_NOTE,
  VOICE_MODE_NOTE,
  WEB_TOOLS_NOTE,
} from "@/lib/claude/system";
import { getMode } from "@/lib/claude/modes";
import { appendMessage } from "@/lib/chat/branches";
import { streamAgentTurn } from "@/lib/chat/run-turn";
import { runOrchestration } from "@/lib/agents/orchestrate";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_ATTACH_BYTES = 15 * 1024 * 1024;

type Body = {
  conversationId?: string;
  projectId?: string | null;
  model?: string;
  effort?: string;
  message?: string;
  attachments?: Attachment[];
  skillIds?: string[];
  researchMode?: boolean;
  webSearch?: boolean;
  selfCheck?: boolean;
  mode?: string;
  team?: boolean;
  voice?: boolean;
  thinking?: boolean;
};

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  const attachments = (body.attachments ?? []).filter(
    (a) => a && a.dataBase64 && a.mime && a.name,
  );
  if (!message && attachments.length === 0) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  const totalBytes = attachments.reduce(
    (n, a) => n + Math.floor((a.dataBase64.length * 3) / 4),
    0,
  );
  if (totalBytes > MAX_ATTACH_BYTES) {
    return NextResponse.json(
      { error: "Attachments exceed 15 MB total." },
      { status: 413 },
    );
  }

  const { model } = resolveModel(body.model ?? "claude-opus-4-8", body.effort ?? "high");
  const effort = body.effort ?? "high";

  // Resolve or create the conversation.
  let convId = body.conversationId;
  let isNew = false;
  if (convId) {
    const existing = (
      await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, convId), eq(conversations.userId, user.id)))
    )[0];
    if (!existing) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
  } else {
    const created = await db
      .insert(conversations)
      .values({
        userId: user.id,
        projectId: body.projectId || null,
        title: truncate(message || "New chat", 50),
        model: model.id,
        effort,
      })
      .returning();
    convId = created[0].id;
    isNew = true;
  }

  const conv = (
    await db.select().from(conversations).where(eq(conversations.id, convId))
  )[0];

  // If a confirmation was pending and the user sent a new message instead of
  // confirming, treat it as declining the pending writes so API state stays valid.
  if (conv?.pendingToolUses?.length) {
    const decisions: Record<string, "approve" | "reject"> = {};
    for (const p of conv.pendingToolUses)
      if (p.kind === "write") decisions[p.id] = "reject";
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ev of applyPendingDecisions({
      userId: user.id,
      conversationId: convId,
      pending: conv.pendingToolUses,
      decisions,
    })) {
      // drain
    }
  }

  // Persist the user message (metadata only — not raw file bytes).
  const userBlocks: MessageBlock[] = [];
  for (const a of attachments) {
    userBlocks.push(
      a.mime.startsWith("image/")
        ? { type: "image", mime: a.mime, name: a.name }
        : { type: "document", mime: a.mime, name: a.name },
    );
  }
  if (message) userBlocks.push({ type: "text", text: message });
  await appendMessage({
    conversationId: convId,
    role: "user",
    blocks: userBlocks,
  });
  await recordAudit({
    userId: user.id,
    action: "chat.message",
    detail: truncate(message || "(attachment)", 200),
    conversationId: convId,
  });

  if (Array.isArray(body.skillIds)) {
    await db
      .update(conversations)
      .set({ skillIds: body.skillIds })
      .where(eq(conversations.id, convId));
  }
  const activeSkillIds = Array.isArray(body.skillIds)
    ? body.skillIds
    : (conv?.skillIds ?? null);

  const plugins = await effectivePlugins(user.id);
  const googleEnabled =
    plugins.google !== false && (await isGoogleConnected(user.id));
  const researchMode = Boolean(body.researchMode);
  const webSearch =
    typeof body.webSearch === "boolean"
      ? body.webSearch
      : plugins.web_search === true;

  let system = await buildChatSystem(
    user,
    { projectId: conv?.projectId ?? null, skillIds: activeSkillIds },
    googleEnabled,
  );
  const mode = getMode(body.mode);
  if (mode?.note) system = `${system}\n\n${mode.note}`;
  // Research mode's prompt already covers web usage in depth; only add the
  // lighter web-tools note when plain web search is on without research mode.
  if (webSearch && !researchMode) system = `${system}\n\n${WEB_TOOLS_NOTE}`;
  if (researchMode) system = `${system}\n\n${RESEARCH_MODE_NOTE}`;
  if (body.selfCheck) system = `${system}\n\n${SELF_CHECK_NOTE}`;
  if (body.voice) system = `${system}\n\n${VOICE_MODE_NOTE}`;

  const conversationId = convId;
  const convTitle = conv?.title ?? truncate(message, 50);

  // Team mode: route this turn through the multi-agent orchestrator.
  if (body.team) {
    const encoder = new TextEncoder();
    const teamStream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) =>
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        send({ type: "meta", conversationId, isNew, title: convTitle });
        try {
          for await (const ev of runOrchestration({
            userId: user.id,
            conversationId,
            model: model.id,
            effort,
            baseSystem: system,
            message,
            attachments,
          })) {
            send(ev);
          }
        } catch (err) {
          send({
            type: "error",
            message: err instanceof Error ? err.message : "Team run failed",
          });
        }
        controller.close();
      },
    });
    return new Response(teamStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  }

  const stream = streamAgentTurn({
    agentOptions: {
      userId: user.id,
      conversationId,
      model: model.id,
      effort,
      system,
      googleEnabled,
      webSearch,
      researchMode,
      thinking: body.thinking,
      liveAttachments: attachments,
      liveText: message,
      signal: req.signal,
    },
    meta: { conversationId, isNew, title: convTitle },
    convTitle,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
