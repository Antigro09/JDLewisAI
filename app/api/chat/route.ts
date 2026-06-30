import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  conversations,
  messages,
  projects,
  projectFiles,
  type MessageBlock,
} from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/server";
import { buildSystemPrompt } from "@/lib/claude/system";
import { streamChat } from "@/lib/claude/chat";
import type { Attachment, ChatTurn } from "@/lib/claude/types";
import { resolveModel } from "@/lib/claude/models";
import { recordUsage } from "@/lib/usage";
import { truncate } from "@/lib/utils";

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
};

function blocksToText(blocks: MessageBlock[]): string {
  return blocks
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");
}

async function projectContext(projectId: string): Promise<{
  name: string;
  instructions: string | null;
}> {
  const proj = (
    await db.select().from(projects).where(eq(projects.id, projectId))
  )[0];
  if (!proj) return { name: "", instructions: null };

  const files = await db
    .select()
    .from(projectFiles)
    .where(eq(projectFiles.projectId, projectId));

  let extra = proj.instructions ? proj.instructions + "\n" : "";
  let budget = 50_000;
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
  return { name: proj.name, instructions: extra || null };
}

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

  const { model } = resolveModel(
    body.model ?? "claude-opus-4-8",
    body.effort ?? "high",
  );
  const effort = body.effort ?? "high";

  // Resolve or create the conversation.
  let convId = body.conversationId;
  let isNew = false;
  if (convId) {
    const existing = (
      await db
        .select()
        .from(conversations)
        .where(
          and(eq(conversations.id, convId), eq(conversations.userId, user.id)),
        )
    )[0];
    if (!existing) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
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

  // Build history turns from stored messages.
  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, convId))
    .orderBy(asc(messages.createdAt));

  const turns: ChatTurn[] = history.map((m) => ({
    role: m.role,
    text: blocksToText(m.blocks),
  }));

  // Current user turn (with live attachments).
  turns.push({ role: "user", text: message, attachments });

  // System prompt with personalization + project context.
  let projName: string | null = null;
  let projInstr: string | null = null;
  const conv = (
    await db.select().from(conversations).where(eq(conversations.id, convId))
  )[0];
  if (conv?.projectId) {
    const ctx = await projectContext(conv.projectId);
    projName = ctx.name;
    projInstr = ctx.instructions;
  }
  const system = buildSystemPrompt({
    personalization: user.personalization,
    projectName: projName,
    projectInstructions: projInstr,
  });

  // Persist the user message immediately (metadata only — not raw file bytes).
  const userBlocks: MessageBlock[] = [];
  for (const a of attachments) {
    userBlocks.push(
      a.mime.startsWith("image/")
        ? { type: "image", mime: a.mime, name: a.name }
        : { type: "document", mime: a.mime, name: a.name },
    );
  }
  if (message) userBlocks.push({ type: "text", text: message });
  await db.insert(messages).values({
    conversationId: convId,
    role: "user",
    blocks: userBlocks,
  });

  const encoder = new TextEncoder();
  const conversationId = convId;
  const convTitle = conv?.title ?? truncate(message, 50);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      send({ type: "meta", conversationId, isNew, title: convTitle });

      let assistantText = "";
      let thinkingText = "";
      let inTok = 0;
      let outTok = 0;

      try {
        for await (const ev of streamChat({
          model: model.id,
          effort,
          system,
          turns,
        })) {
          if (ev.type === "text") {
            assistantText += ev.text;
            send({ type: "text", text: ev.text });
          } else if (ev.type === "thinking") {
            thinkingText += ev.text;
            send({ type: "thinking", text: ev.text });
          } else if (ev.type === "error") {
            send({ type: "error", message: ev.message });
          } else if (ev.type === "done") {
            inTok = ev.inputTokens;
            outTok = ev.outputTokens;
          }
        }
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Stream failed",
        });
      }

      // Persist the assistant message + usage.
      const aBlocks: MessageBlock[] = [];
      if (thinkingText) aBlocks.push({ type: "thinking", text: thinkingText });
      aBlocks.push({ type: "text", text: assistantText });
      try {
        await db.insert(messages).values({
          conversationId,
          role: "assistant",
          blocks: aBlocks,
          model: model.id,
          inputTokens: inTok,
          outputTokens: outTok,
        });
        await db
          .update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, conversationId));
      } catch {
        // ignore persistence errors in the stream tail
      }
      await recordUsage({
        userId: user.id,
        model: model.id,
        feature: "chat",
        inputTokens: inTok,
        outputTokens: outTok,
      });

      send({ type: "done", inputTokens: inTok, outputTokens: outTok });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
