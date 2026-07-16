import { eq } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import {
  conversations,
  type MessageBlock,
  type PendingToolUse,
} from "@/lib/db/schema";
import { anthropic } from "./client";
import { resolveModel } from "./models";
import { attachmentBlocks, buildSystemBlocks } from "./chat";
import { classifyModelError } from "./errors";
import { wrapUntrusted } from "./system";
import type { Attachment, SystemPromptParts } from "./types";
import { type ToolExecutionContext } from "@/lib/tools/google-tools";
// Side-effect import: populates the tool registry with every tool.
import "@/lib/tools/register";
import { toolRegistry, type ToolContext, type ToolResult } from "@/lib/tools/registry";
import { recordUsage } from "@/lib/usage";
import { recordAudit } from "@/lib/audit";
import { appendMessage, buildActivePath } from "@/lib/chat/branches";

const MAX_STEPS = 8;

/** Stored attachments above this size are not resent to the model on later
 * turns (they degrade to a text placeholder) to keep request sizes sane. */
const MAX_RESEND_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Context compaction strategy: server-side context editing (beta
 * context-management-2025-06-27). Once a tool-heavy conversation grows past
 * the trigger, the API clears the CONTENT of the oldest tool results before
 * the model sees them — we never mutate stored history or apiMessages, so
 * tool_use/tool_result pairing, assistant rawContent (thinking signatures),
 * the 3 cache breakpoints, and pending-tool resume are all untouched. Below
 * the trigger the server clears nothing, so short conversations render
 * byte-for-byte identically. If the beta is ever rejected, the in-process
 * flag below flips and the step retries without it (no compaction, no hard
 * failure). */
const CONTEXT_EDITING_BETA = "context-management-2025-06-27";
const CONTEXT_EDITING: Anthropic.Beta.BetaContextManagementConfig = {
  edits: [
    {
      type: "clear_tool_uses_20250919",
      // Generous trigger (~100k input tokens ≈ hours of tool use); keep the
      // newest 5 tool results fully intact; skip edits that would reclaim
      // under 5k tokens so the prompt cache isn't churned for scraps.
      trigger: { type: "input_tokens", value: 100_000 },
      keep: { type: "tool_uses", value: 5 },
      clear_at_least: { type: "input_tokens", value: 5_000 },
    },
  ],
};
/** Flips off for the life of the process (single long-lived EC2 node) the
 * first time the API rejects the context-management beta. */
let contextEditingSupported = true;

/** 400 that names context management — the only error worth a silent retry
 * without the beta. Anything else propagates to classifyModelError as usual. */
function isContextEditingRejection(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = (err as { status?: number }).status;
  return status === 400 && /context.management/i.test(err.message);
}

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "tool_activity";
      tool: string;
      summary: string;
      link?: string;
      isError?: boolean;
      /** Standardized-result extras (registry tools). UI-facing only. */
      status?: string;
      confidence?: number;
      artifacts?: { kind: string; label: string; url?: string }[];
    }
  | {
      type: "tool_request";
      pending: { id: string; name: string; kind: "read" | "write"; summary: string }[];
    }
  | { type: "error"; message: string; retryable?: boolean }
  | { type: "done"; inputTokens: number; outputTokens: number };

type ApiContentBlock = Record<string, unknown>;
type ApiMessage = { role: "user" | "assistant"; content: ApiContentBlock[] };

/** Attachment → API blocks, loosened to sit alongside raw stored JSON blocks. */
function attachmentApiBlocks(a: Attachment): ApiContentBlock[] {
  return attachmentBlocks(a) as unknown as ApiContentBlock[];
}

// wrapUntrusted moved to ./system (shared with the knowledge-search path).

/**
 * Run one registry tool, streaming its `onProgress` callbacks out as
 * tool_activity events as they happen, and returning the final ToolResult.
 * A tiny queue + wake promise interleaves progress with the awaited call so a
 * multi-step engine tool (upload → index → measure) reports live rather than
 * dumping everything at the end.
 */
async function* runToolStreaming(
  baseCtx: ToolContext,
  name: string,
  input: Record<string, unknown>,
): AsyncGenerator<AgentEvent, ToolResult> {
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let settled = false;
  const ctx: ToolContext = {
    ...baseCtx,
    onProgress: (summary) => {
      queue.push(summary);
      wake?.();
      wake = null;
    },
  };
  const exec = toolRegistry.execute(ctx, name, input).then((r) => {
    settled = true;
    wake?.();
    wake = null;
    return r;
  });
  for (;;) {
    const wait = settled ? null : new Promise<void>((resolve) => { wake = resolve; });
    while (queue.length) {
      yield { type: "tool_activity", tool: name, summary: queue.shift()! };
    }
    if (settled) break;
    await Promise.race([exec, wait as Promise<void>]);
  }
  return await exec;
}

/** Loads the conversation's active branch only — not every message ever sent
 * in every branch — so the model never sees content from an inactive branch. */
async function loadMessages(conversationId: string) {
  const conv = (
    await db
      .select({ activeLeafId: conversations.activeLeafId })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
  )[0];
  return buildActivePath(conversationId, conv?.activeLeafId ?? null);
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
        else if (b.type === "image" || b.type === "document") {
          // Resend the real attachment bytes so the model keeps seeing them on
          // later turns; legacy rows without bytes (and oversized files) fall
          // back to a text placeholder.
          const bytes = b.dataBase64
            ? Math.floor((b.dataBase64.length * 3) / 4)
            : 0;
          if (b.dataBase64 && bytes <= MAX_RESEND_ATTACHMENT_BYTES) {
            content.push(
              ...attachmentApiBlocks({
                mime: b.mime,
                name: b.name,
                dataBase64: b.dataBase64,
              }),
            );
          } else {
            content.push({ type: "text", text: `[Attachment: ${b.name}]` });
          }
        }
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

/** Block types that accept a cache_control marker. */
const CACHEABLE_BLOCK_TYPES = new Set([
  "text",
  "image",
  "document",
  "tool_use",
  "tool_result",
]);

/** Cache breakpoint 3 of 3: strip stale cache markers from the history, then
 * mark the most recent cacheable block so each agent step (and the next turn)
 * re-reads the entire prior conversation from cache. */
function markHistoryCache(messages: ApiMessage[]): ApiMessage[] {
  const out = messages.map((m) => ({
    role: m.role,
    content: m.content.map((b) => {
      if ("cache_control" in b) {
        const rest: ApiContentBlock = { ...b };
        delete rest.cache_control;
        return rest;
      }
      return b;
    }),
  }));
  outer: for (let i = out.length - 1; i >= 0; i--) {
    const content = out[i].content;
    for (let j = content.length - 1; j >= 0; j--) {
      if (CACHEABLE_BLOCK_TYPES.has(String(content[j].type))) {
        content[j] = { ...content[j], cache_control: { type: "ephemeral" } };
        break outer;
      }
    }
  }
  return out;
}

export type RunAgentOptions = {
  userId: string;
  conversationId: string;
  model: string;
  effort: string;
  /** Plain string (automations) or stable/volatile pair (chat routes) — the
   * stable part gets a cache breakpoint, the volatile part rides after it. */
  system: string | SystemPromptParts;
  googleEnabled: boolean;
  liveAttachments?: Attachment[];
  liveText?: string;
  /** Execute write/send tools without pausing (unattended automation runs). */
  autoApprove?: boolean;
  /** Threaded into external tool executors; unattended runs carry the
   * automation's send guardrails (recipient allowlist + daily cap). */
  execContext?: ToolExecutionContext;
  /** Restrict which Google tools are available (by tool name). */
  toolNames?: string[];
  /** Usage-metering feature label (default "chat"). */
  usageFeature?: string;
  /** Enable the Anthropic web search server tool. */
  webSearch?: boolean;
  /** Deeper multi-step investigation: raises the step cap and forces web search on. */
  researchMode?: boolean;
  /** Extended thinking toggle (default on for models that support it). */
  thinking?: boolean;
  /** Anthropic Skills API skills to load in a code-execution container. */
  containerSkills?: { skillId: string; version: string }[];
  /** Connected remote MCP servers (mcp-client-2025-11-20). */
  mcp?: {
    servers: unknown[];
    toolsets: unknown[];
  };
  /** Route-level prompt-note flags persisted with a paused turn so the
   * confirm/resume path can rebuild the same volatile system suffix. */
  resumeContext?: { mode?: string; selfCheck?: boolean; voice?: boolean };
  /** Abort signal — stops generation when the client cancels the request. */
  signal?: AbortSignal;
};

/**
 * Drive a chat turn: stream model output, auto-run read tools, and pause for
 * confirmation when a write/send tool is requested. Resumes from current DB
 * state, so callers must persist the preceding user/tool_result message first.
 */
export async function* runAgentTurn(
  opts: RunAgentOptions,
): AsyncGenerator<AgentEvent> {
  const { model, effort } = resolveModel(opts.model, opts.effort);

  const rows = await loadMessages(opts.conversationId);
  const apiMessages = buildApiMessages(rows);

  // Overlay live attachments + text onto the latest user turn (first step only).
  if (opts.liveAttachments?.length && apiMessages.length) {
    const last = apiMessages[apiMessages.length - 1];
    if (last.role === "user") {
      const blocks: ApiContentBlock[] = [];
      for (const a of opts.liveAttachments)
        blocks.push(...attachmentApiBlocks(a));
      if (opts.liveText) blocks.push({ type: "text", text: opts.liveText });
      last.content = blocks.length ? blocks : last.content;
    }
  }

  // Context threaded to every tool (executor + gate). Native tool-use is the
  // router; the registry's `available()` is just the deterministic gate that
  // decides which tools are even offered this turn.
  const toolCtx: ToolContext = {
    userId: opts.userId,
    conversationId: opts.conversationId,
    attachments: opts.liveAttachments,
    signal: opts.signal,
    execContext: opts.execContext,
    googleEnabled: opts.googleEnabled,
    toolNames: opts.toolNames,
  };

  const tools: unknown[] = [];
  // Registry tools: local calculators (always), Google (if enabled), and any
  // engine tools whose gate passes (e.g. material_takeoff when a PDF is
  // attached or a takeoff is already linked to this conversation).
  const activeTools = await toolRegistry.available(toolCtx);
  tools.push(...toolRegistry.definitions(activeTools));
  // Cache breakpoint 2 of 3: mark the last CUSTOM tool definition. Server-tool
  // entries (which reject cache_control) are appended after this point, so
  // custom tools stay first and form a cacheable prefix.
  if (tools.length) {
    tools[tools.length - 1] = {
      ...(tools[tools.length - 1] as Record<string, unknown>),
      cache_control: { type: "ephemeral" },
    };
  }
  // Container-executed skills (Skills API) run in a code-execution sandbox on
  // Opus/Sonnet-tier models. Haiku can't run code execution, so skip there.
  const containerSkillsActive =
    (opts.containerSkills?.length ?? 0) > 0 && !model.id.includes("haiku");
  if (containerSkillsActive) {
    tools.push({ type: "code_execution_20260521", name: "code_execution" });
  }

  // Remote MCP servers: Anthropic connects to them server-side; each server
  // needs exactly one mcp_toolset entry in `tools`.
  const mcpActive = (opts.mcp?.servers.length ?? 0) > 0;
  if (mcpActive) tools.push(...opts.mcp!.toolsets);

  const webSearchEnabled = opts.webSearch || opts.researchMode;
  if (webSearchEnabled) {
    // The dynamic-filtering web_search_20260209 runs its own code execution
    // under the hood; stacking that with the skills sandbox confuses the model,
    // so fall back to the basic variant whenever a container skill is active
    // (also used on Haiku, which lacks the dynamic-filtering variant).
    if (model.id.includes("haiku") || containerSkillsActive) {
      tools.push({ type: "web_search_20250305", name: "web_search" });
    } else {
      // The _20260209 variant defaults to the code-execution caller and requires
      // allowed_callers: ["direct"] on models without programmatic tool calling,
      // or the API rejects the request — so pin it to direct invocation.
      tools.push({
        type: "web_search_20260209",
        name: "web_search",
        allowed_callers: ["direct"],
      });
    }
    // Fetch and read specific URLs the user references (not just search).
    // Basic GA variant: ZDR-eligible and defaults to direct caller.
    tools.push({ type: "web_fetch_20250910", name: "web_fetch", max_uses: 5 });
  }
  const maxSteps = opts.researchMode ? 16 : MAX_STEPS;
  let inTok = 0;
  let outTok = 0;
  let cacheWriteTok = 0;
  let cacheReadTok = 0;
  let webSearchReqs = 0;
  // In-flight step usage captured from stream events, so a step cut short by
  // abort or a mid-stream error (where finalMessage() never resolves) is still
  // metered. Zeroed once finalMessage() lands; folded into totals in finally.
  let stepIn = 0;
  let stepOut = 0;
  let stepCacheW = 0;
  let stepCacheR = 0;
  let stepWebSearch = 0;

  const finish = async () => {
    await recordUsage({
      userId: opts.userId,
      model: model.id,
      feature: opts.usageFeature ?? "chat",
      inputTokens: inTok,
      outputTokens: outTok,
      cacheCreationInputTokens: cacheWriteTok,
      cacheReadInputTokens: cacheReadTok,
      webSearchRequests: webSearchReqs,
    });
  };

  try {
    for (let step = 0; step < maxSteps; step++) {
      const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
        model: model.id,
        max_tokens: 16000,
        // Cache breakpoint 1 of 3 lives on the stable system block.
        system: buildSystemBlocks(opts.system),
        // Stored rawContent blocks are untyped JSON from the DB — missing
        // type: Anthropic.Beta.BetaMessageParam.
        messages: markHistoryCache(
          apiMessages,
        ) as unknown as Anthropic.Beta.BetaMessageParam[],
      };
      if (tools.length) {
        // Tool defs come from lib/tools/* and lib/mcp with loose JSON schemas —
        // missing type: Anthropic.Beta.BetaToolUnion.
        params.tools = tools as unknown as Anthropic.Beta.BetaToolUnion[];
      }
      if (model.adaptiveThinking && opts.thinking !== false)
        params.thinking = { type: "adaptive", display: "summarized" };
      if (effort) params.output_config = { effort };
      // Skills API + MCP connector both need beta opt-ins. The request always
      // goes through the beta endpoint (superset of the GA surface) so the
      // whole loop shares one typed params shape.
      const betas: string[] = [];
      if (containerSkillsActive) {
        betas.push("code-execution-2025-08-25", "skills-2025-10-02");
        params.container = {
          skills: opts.containerSkills!.map((s) => ({
            type: "custom",
            skill_id: s.skillId,
            version: s.version,
          })),
        };
      }
      if (mcpActive) {
        betas.push("mcp-client-2025-11-20");
        // MCP server definitions are validated in lib/mcp/connections.ts —
        // missing type: Anthropic.Beta.BetaRequestMCPServerURLDefinition.
        params.mcp_servers = opts.mcp!
          .servers as Anthropic.Beta.BetaRequestMCPServerURLDefinition[];
      }
      let final: Anthropic.Beta.BetaMessage;
      // Normally one pass; a second pass only happens when the context-editing
      // beta is rejected before anything streamed to the client.
      for (;;) {
        const attemptBetas = contextEditingSupported
          ? [...betas, CONTEXT_EDITING_BETA]
          : betas;
        if (attemptBetas.length) params.betas = attemptBetas;
        else delete params.betas;
        if (contextEditingSupported) params.context_management = CONTEXT_EDITING;
        else delete params.context_management;

        const stream = anthropic().beta.messages.stream(
          params,
          opts.signal ? { signal: opts.signal } : undefined,
        );

        // Guards the retry: never re-run a step whose output already reached
        // the client (beta rejections 400 before any content streams).
        let emitted = false;
        try {
          for await (const event of stream) {
            if (opts.signal?.aborted) break;
            if (event.type === "message_start") {
              stepIn = event.message.usage.input_tokens;
              stepCacheW = event.message.usage.cache_creation_input_tokens ?? 0;
              stepCacheR = event.message.usage.cache_read_input_tokens ?? 0;
            } else if (event.type === "message_delta") {
              stepOut = event.usage.output_tokens; // cumulative
              stepWebSearch = event.usage.server_tool_use?.web_search_requests ?? 0;
            } else if (event.type === "content_block_delta") {
              if (event.delta.type === "thinking_delta") {
                emitted = true;
                yield { type: "thinking", text: event.delta.thinking };
              } else if (event.delta.type === "text_delta") {
                emitted = true;
                yield { type: "text", text: event.delta.text };
              }
            }
          }

          // Client stopped generation — halt without persisting this turn.
          // (The partial step's usage is folded into totals in finally.)
          if (opts.signal?.aborted) return;

          final = await stream.finalMessage();
          break;
        } catch (err) {
          if (contextEditingSupported && !emitted && isContextEditingRejection(err)) {
            console.error("context-management beta rejected — disabling:", err);
            contextEditingSupported = false;
            continue; // retry this step without the beta
          }
          throw err;
        }
      }
      inTok += final.usage.input_tokens;
      outTok += final.usage.output_tokens;
      cacheWriteTok += final.usage.cache_creation_input_tokens ?? 0;
      cacheReadTok += final.usage.cache_read_input_tokens ?? 0;
      webSearchReqs += final.usage.server_tool_use?.web_search_requests ?? 0;
      stepIn = stepOut = stepCacheW = stepCacheR = stepWebSearch = 0;

      const content = final.content as unknown as ApiContentBlock[];
      apiMessages.push({ role: "assistant", content });

      // Persist the assistant turn (display blocks + verbatim rawContent).
      await appendMessage({
        conversationId: opts.conversationId,
        role: "assistant",
        blocks: contentToBlocks(content),
        rawContent: content,
        model: model.id,
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
      });

      const toolUses = content.filter((c) => c.type === "tool_use");
      // Server tools (e.g. web search) hit their iteration limit — re-send to continue.
      if (final.stop_reason === "pause_turn") continue;
      if (final.stop_reason !== "tool_use" || toolUses.length === 0) {
        break;
      }

      const classified = toolUses.map((tu) => ({
        id: String(tu.id),
        name: String(tu.name),
        input: (tu.input ?? {}) as Record<string, unknown>,
        kind: toolRegistry.get(String(tu.name))?.descriptor.kind ?? "read",
      }));

      const hasWrite = classified.some((c) => c.kind === "write");
      if (hasWrite && !opts.autoApprove) {
        const pending: PendingToolUse[] = classified.map((c) => ({
          id: c.id,
          name: c.name,
          input: c.input,
          kind: c.kind,
        }));
        // Persist the per-turn options the confirm/resume path needs to
        // rebuild this exact request (first entry only).
        pending[0].resume = {
          model: opts.model,
          effort: opts.effort,
          researchMode: opts.researchMode,
          webSearch: opts.webSearch,
          thinking: opts.thinking,
          ...opts.resumeContext,
        };
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
              toolRegistry.get(p.name)?.describe?.(
                (p.input ?? {}) as Record<string, unknown>,
              ) ??
              toolRegistry.get(p.name)?.descriptor.title ??
              p.name,
          })),
        };
        return; // pause until /api/chat/confirm — metering runs in finally
      }

      // All reads: execute now, append results, loop.
      const resultContent: ApiContentBlock[] = [];
      const resultBlocks: MessageBlock[] = [];
      for (const c of classified) {
        // Run through the registry, streaming its progress() as tool_activity.
        const gen = runToolStreaming(toolCtx, c.name, c.input);
        let raw: ToolResult;
        while (true) {
          const nx = await gen.next();
          if (nx.done) {
            raw = nx.value;
            break;
          }
          yield nx.value;
        }
        // Fence attacker-controlled external output (Google/MCP/web). Our own
        // engines + local calculators declare fenceOutput:false.
        const fence = toolRegistry.get(c.name)?.descriptor.fenceOutput;
        const r = fence ? { ...raw, output: wrapUntrusted(raw.output) } : raw;
        await recordAudit({
          userId: opts.userId,
          action: `tool.${c.name}`,
          detail: r.summary,
          conversationId: opts.conversationId,
        });
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
          status: r.status,
          confidence: r.confidence,
          artifacts: r.artifacts?.map((a) => ({ kind: a.kind, label: a.label, url: a.url })),
        };
      }
      apiMessages.push({ role: "user", content: resultContent });
      await appendMessage({
        conversationId: opts.conversationId,
        role: "user",
        blocks: resultBlocks,
      });
    }

    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, opts.conversationId));
    yield { type: "done", inputTokens: inTok, outputTokens: outTok };
  } catch (err) {
    const friendly = classifyModelError(err);
    if (friendly) {
      console.error("runAgentTurn failed:", err);
      yield { type: "error", ...friendly };
    }
    // null = client abort — no error event at all.
  } finally {
    // Meter every turn that consumed tokens exactly once — success, pause,
    // error, or abort all pass through here. Fold in any step that was cut
    // short before finalMessage() resolved.
    inTok += stepIn;
    outTok += stepOut;
    cacheWriteTok += stepCacheW;
    cacheReadTok += stepCacheR;
    webSearchReqs += stepWebSearch;
    if (inTok || outTok || cacheWriteTok || cacheReadTok) await finish();
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
    const raw = await toolRegistry.execute(
      { userId: opts.userId, conversationId: opts.conversationId },
      p.name,
      (p.input ?? {}) as Record<string, unknown>,
    );
    // Same fencing as runAgentTurn: fence external (Google/MCP/web) output.
    const fence = toolRegistry.get(p.name)?.descriptor.fenceOutput;
    const r = fence ? { ...raw, output: wrapUntrusted(raw.output) } : raw;
    await recordAudit({
      userId: opts.userId,
      action: `tool.${p.name}`,
      detail: `Approved: ${r.summary}`,
      conversationId: opts.conversationId,
    });
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

  await appendMessage({
    conversationId: opts.conversationId,
    role: "user",
    blocks: resultBlocks,
  });
  await db
    .update(conversations)
    .set({ pendingToolUses: null })
    .where(eq(conversations.id, opts.conversationId));
}
