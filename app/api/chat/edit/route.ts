import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, messages, type MessageBlock } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/server";
import { applyPendingDecisions } from "@/lib/claude/agent";
import type { Attachment } from "@/lib/claude/types";
import { resolveModel } from "@/lib/claude/models";
import { isGoogleConnected } from "@/lib/google/client";
import { effectivePlugins } from "@/lib/plugins";
import { buildChatSystem } from "@/lib/data";
import { resolveContainerSkills } from "@/lib/skills";
import { WEB_TOOLS_NOTE } from "@/lib/claude/system";
import { appendMessage } from "@/lib/chat/branches";
import { streamAgentTurn } from "@/lib/chat/run-turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_ATTACH_BYTES = 15 * 1024 * 1024;

type Body = {
  conversationId?: string;
  editMessageId?: string;
  newText?: string;
  attachments?: Attachment[];
  model?: string;
  effort?: string;
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

  const conversationId = body.conversationId;
  const editMessageId = body.editMessageId;
  const newText = (body.newText ?? "").trim();
  const attachments = (body.attachments ?? []).filter(
    (a) => a && a.dataBase64 && a.mime && a.name,
  );
  if (!conversationId || !editMessageId) {
    return NextResponse.json({ error: "Missing conversationId/editMessageId" }, { status: 400 });
  }
  if (!newText && attachments.length === 0) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }
  const totalBytes = attachments.reduce(
    (n, a) => n + Math.floor((a.dataBase64.length * 3) / 4),
    0,
  );
  if (totalBytes > MAX_ATTACH_BYTES) {
    return NextResponse.json({ error: "Attachments exceed 15 MB total." }, { status: 413 });
  }

  const conv = (
    await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, user.id)))
  )[0];
  if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const edited = (
    await db.select().from(messages).where(eq(messages.id, editMessageId))
  )[0];
  if (!edited || edited.conversationId !== conversationId || edited.role !== "user") {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  // Editing abandons the old branch tip — decline any writes that were
  // paused waiting on it, same as sending a fresh message over a pending one.
  if (conv.pendingToolUses?.length) {
    const decisions: Record<string, "approve" | "reject"> = {};
    for (const p of conv.pendingToolUses) if (p.kind === "write") decisions[p.id] = "reject";
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ev of applyPendingDecisions({
      userId: user.id,
      conversationId,
      pending: conv.pendingToolUses,
      decisions,
    })) {
      // drain
    }
  }

  const { model } = resolveModel(body.model ?? conv.model, body.effort ?? conv.effort);
  const effort = body.effort ?? conv.effort;

  const blocks: MessageBlock[] = [];
  for (const a of attachments) {
    blocks.push(
      a.mime.startsWith("image/")
        ? { type: "image", mime: a.mime, name: a.name }
        : { type: "document", mime: a.mime, name: a.name },
    );
  }
  if (newText) blocks.push({ type: "text", text: newText });

  // New sibling of the edited message — same parent, new branch.
  await appendMessage({
    conversationId,
    role: "user",
    blocks,
    parentId: edited.parentId,
  });

  const plugins = await effectivePlugins(user.id);
  const googleEnabled = plugins.google !== false && (await isGoogleConnected(user.id));
  const webSearch = plugins.web_search === true;
  const containerSkills = await resolveContainerSkills(user, conv.skillIds);
  let system = await buildChatSystem(
    user,
    { projectId: conv.projectId, skillIds: conv.skillIds },
    googleEnabled,
  );
  if (webSearch) system = `${system}\n\n${WEB_TOOLS_NOTE}`;

  const stream = streamAgentTurn({
    agentOptions: {
      userId: user.id,
      conversationId,
      model: model.id,
      effort,
      system,
      googleEnabled,
      webSearch,
      containerSkills,
      liveAttachments: attachments,
      liveText: newText,
      signal: req.signal,
    },
    meta: { conversationId },
    convTitle: conv.title,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
