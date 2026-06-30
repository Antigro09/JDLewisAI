import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  conversations,
  messages,
  type MessageBlock,
  type PendingToolUse,
} from "@/lib/db/schema";
import { anthropic } from "./client";
import { resolveModel } from "./models";
import { attachmentBlocks } from "./chat";
import type { Attachment } from "./types";
import {
  getGoogleTool,
  googleToolDefinitions,
  runGoogleTool,
} from "@/lib/tools/google-tools";
import { recordUsage } from "@/lib/usage";

const MAX_STEPS = 8;

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "tool_activity";
      tool: string;
      summary: string;
      link?: string;
      isError?: boolean;
    }
  | {
      type: "tool_request";
      pending: { id: string; name: string; kind: "read" | "write"; summary: string }[];
    }
  | { type: "error"; message: string }
  | { type: "done"; inputTokens: number; outputTokens: number };

type ApiContentBlock = Record<string, unknown>;
type ApiMessage = { role: "user" | "assistant"; content: ApiContentBlock[] };

async function loadMessages(conversationId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
}

/** Rebuild Anthropic API messages from stored rows. */
function buildApiMessages(
  rows: { role: "user" | "assistant"; blocks: MessageBlock[]; rawContent: unknown[] | null }[],
): ApiMessage[] {
  const out: ApiMessage[] = [];
  for (const m of rows) {
    if (m.role === "assistant") {
      if (m.rawContent && Array.isArray(m.rawContent) && m.rawContent.length) {
        out.push({ role: "assistant", content: m.rawContent as ApiContentBlock[] });
        continue;
      }
      const content: ApiContentBlock[] = [];
      for (const b of m.blocks) {
        if (b.type === "text" && b.text) content.push({ type: "text", text: b.text });
        else if (b.type === "tool_use")
          content.push({ type: "tool_use", id: b.id, name: b.name, input: b.input ?? {} });
      }
      if (content.length) out.push({ role: "assistant", content });
    } else {
      const content: ApiContentBlock[] = [];
      for (const b of m.blocks) {
        if (b.type === "text" && b.text) content.push({ type: "text", text: b.text });
        else if (b.type === "tool_result")
          content.push({
            type: "tool_result",
            tool_use_id: b.toolUseId,
            content: b.output,
            ...(b.isError ? { is_error: true } : {}),
          });
        else if (b.type === "image" || b.type === "document")
          content.push({ type: "text", text: `[Attachment: ${b.name}]` });
      }
      if (content.length) out.push({ role: "user", content });
    }
  }
  return out;
}

/** Convert raw assistant API content into stored display blocks. */
function contentToBlocks(content: ApiContentBlock[]): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  for (const c of content) {
    if (c.type === "thinking" && typeof c.thinking === "string" && c.thinking)
      blocks.push({ type: "thinking", text: c.thinking });
    else if (c.type === "text" && typeof c.text === "string")
      blocks.push({ type: "text", text: c.text });
    else if (c.type === "tool_use")
      blocks.push({
        type: "tool_use",
        id: String(c.id),
        name: String(c.name),
        input: c.input,
      });
  }
  return blocks;
}

export type RunAgentOptions = {
  userId: string;
  conversationId: string;
  model: string;
  effort: string;
  system: string;
  googleEnabled: boolean;
  liveAttachments?: Attachment[];
  liveText?: string;
  /** Execute write/send tools without pausing (unattended automation runs). */
  autoApprove?: boolean;
  /** Restrict which Google tools are available (by tool name). */
  toolNames?: string[];
  /** Usage-metering feature label (default "chat"). */
  usageFeature?: string;
};

/**
 * Drive a chat turn: stream model output, auto-run read tools, and pause for
 * confirmation when a write/send tool is requested. Resumes from current DB
 * state, so callers must persist the preceding user/tool_result message first.
 */
export async function* runAgentTurn(
  opts: RunAgentOptions,
): AsyncGenerator<AgentEvent> {
  const { model } = resolveModel(opts.model, opts.effort);
  const { effort } = resolveModel(opts.model, opts.effort);

  const rows = await loadMessages(opts.conversationId);
  const apiMessages = buildApiMessages(rows);

  // Overlay live attachments + text onto the latest user turn (first step only).
  if (opts.liveAttachments?.length && apiMessages.length) {
    const last = apiMessages[apiMessages.length - 1];
    if (last.role === "user") {
      const blocks: ApiContentBlock[] = [];
      for (const a of opts.liveAttachments)
        blocks.push(...(attachmentBlocks(a) as ApiContentBlock[]));
      if (opts.liveText) blocks.push({ type: "text", text: opts.liveText });
      last.content = blocks.length ? blocks : last.content;
    }
  }

  let tools = opts.googleEnabled ? googleToolDefinitions() : undefined;
  if (tools && opts.toolNames) {
    tools = tools.filter((d) => opts.toolNames!.includes(d.name));
  }
  let inTok = 0;
  let outTok = 0;

  const finish = async () => {
    await recordUsage({
      userId: opts.userId,
      model: model.id,
      feature: opts.usageFeature ?? "chat",
      inputTokens: inTok,
      outputTokens: outTok,
    });
  };

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const params: Record<string, unknown> = {
        model: model.id,
        max_tokens: 16000,
        system: opts.system,
        messages: apiMessages,
      };
      if (tools) params.tools = tools;
      if (model.adaptiveThinking)
        params.thinking = { type: "adaptive", display: "summarized" };
      if (effort) params.output_config = { effort };

      const stream = (
        anthropic().messages as unknown as {
          stream: (p: unknown) => AsyncIterable<Record<string, unknown>> & {
            finalMessage: () => Promise<unknown>;
          };
        }
      ).stream(params);

      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          const delta = event.delta as Record<string, unknown> | undefined;
          if (delta?.type === "thinking_delta")
            yield { type: "thinking", text: String(delta.thinking ?? "") };
          else if (delta?.type === "text_delta")
            yield { type: "text", text: String(delta.text ?? "") };
        }
      }

      const final = (await stream.finalMessage()) as {
        content: ApiContentBlock[];
        stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      inTok += final.usage?.input_tokens ?? 0;
      outTok += final.usage?.output_tokens ?? 0;

      const content = final.content ?? [];
      apiMessages.push({ role: "assistant", content });

      // Persist the assistant turn (display blocks + verbatim rawContent).
      await db.insert(messages).values({
        conversationId: opts.conversationId,
        role: "assistant",
        blocks: contentToBlocks(content),
        rawContent: content,
        model: model.id,
        inputTokens: final.usage?.input_tokens ?? 0,
        outputTokens: final.usage?.output_tokens ?? 0,
      });

      const toolUses = content.filter((c) => c.type === "tool_use");
      if (final.stop_reason !== "tool_use" || toolUses.length === 0) {
        break;
      }

      const classified = toolUses.map((tu) => ({
        id: String(tu.id),
        name: String(tu.name),
        input: (tu.input ?? {}) as Record<string, unknown>,
        kind: getGoogleTool(String(tu.name))?.kind ?? "read",
      }));

      const hasWrite = classified.some((c) => c.kind === "write");
      if (hasWrite && !opts.autoApprove) {
        const pending: PendingToolUse[] = classified.map((c) => ({
          id: c.id,
          name: c.name,
          input: c.input,
          kind: c.kind,
        }));
        await db
          .update(conversations)
          .set({ pendingToolUses: pending, updatedAt: new Date() })
          .where(eq(conversations.id, opts.conversationId));
        yield {
          type: "tool_request",
          pending: pending.map((p) => ({
            id: p.id,
            name: p.name,
            kind: p.kind,
            summary:
              getGoogleTool(p.name)?.describe(
                (p.input ?? {}) as Record<string, unknown>,
              ) ?? p.name,
          })),
        };
        await finish();
        return; // pause until /api/chat/confirm
      }

      // All reads: execute now, append results, loop.
      const resultContent: ApiContentBlock[] = [];
      const resultBlocks: MessageBlock[] = [];
      for (const c of classified) {
        const r = await runGoogleTool(opts.userId, c.name, c.input);
        resultContent.push({
          type: "tool_result",
          tool_use_id: c.id,
          content: r.output,
          ...(r.isError ? { is_error: true } : {}),
        });
        resultBlocks.push({
          type: "tool_result",
          toolUseId: c.id,
          name: c.name,
          output: r.output,
          summary: r.summary,
          link: r.link,
          isError: r.isError,
        });
        yield {
          type: "tool_activity",
          tool: c.name,
          summary: r.summary,
          link: r.link,
          isError: r.isError,
        };
      }
      apiMessages.push({ role: "user", content: resultContent });
      await db.insert(messages).values({
        conversationId: opts.conversationId,
        role: "user",
        blocks: resultBlocks,
      });
    }

    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, opts.conversationId));
    await finish();
    yield { type: "done", inputTokens: inTok, outputTokens: outTok };
  } catch (err) {
    yield {
      type: "error",
      message: err instanceof Error ? err.message : "Agent run failed",
    };
  }
}

/**
 * Execute pending (paused) tool calls per the user's decisions, persist the
 * tool_result turn, clear the pending flag, and yield activity events. The
 * caller then resumes `runAgentTurn`.
 */
export async function* applyPendingDecisions(opts: {
  userId: string;
  conversationId: string;
  pending: PendingToolUse[];
  decisions: Record<string, "approve" | "reject">;
}): AsyncGenerator<AgentEvent> {
  const resultBlocks: MessageBlock[] = [];
  for (const p of opts.pending) {
    const decision = p.kind === "read" ? "approve" : opts.decisions[p.id];
    if (decision === "reject") {
      resultBlocks.push({
        type: "tool_result",
        toolUseId: p.id,
        name: p.name,
        output: "The user declined to run this action.",
        summary: "Declined",
        isError: false,
      });
      yield { type: "tool_activity", tool: p.name, summary: "Declined by user" };
      continue;
    }
    const r = await runGoogleTool(
      opts.userId,
      p.name,
      (p.input ?? {}) as Record<string, unknown>,
    );
    resultBlocks.push({
      type: "tool_result",
      toolUseId: p.id,
      name: p.name,
      output: r.output,
      summary: r.summary,
      link: r.link,
      isError: r.isError,
    });
    yield {
      type: "tool_activity",
      tool: p.name,
      summary: r.summary,
      link: r.link,
      isError: r.isError,
    };
  }

  await db.insert(messages).values({
    conversationId: opts.conversationId,
    role: "user",
    blocks: resultBlocks,
  });
  await db
    .update(conversations)
    .set({ pendingToolUses: null })
    .where(eq(conversations.id, opts.conversationId));
}
