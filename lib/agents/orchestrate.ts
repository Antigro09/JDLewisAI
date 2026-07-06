import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/claude/client";
import {
  generateStructured,
  streamChat,
  attachmentBlocks,
  buildSystemBlocks,
} from "@/lib/claude/chat";
import type { AgentEvent } from "@/lib/claude/agent";
import {
  MECHANICAL_MODEL,
  resolveModel,
  type EffortLevel,
  type ModelInfo,
} from "@/lib/claude/models";
import type { Attachment } from "@/lib/claude/types";
import {
  SPECIALISTS,
  getSpecialist,
  type Specialist,
} from "@/lib/agents/specialists";
import { localToolDefinitions, runLocalTool } from "@/lib/tools/local-tools";
import { recordAudit } from "@/lib/audit";
import { appendMessage } from "@/lib/chat/branches";
import { recordUsage } from "@/lib/usage";
import { log } from "@/lib/log";

type Selected = { id: string; task: string };

type UsageDelta = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

/** Coordinator routing schema: constrained decoding pins `id` to real roster
 * ids, so routing can't fail on typo'd ids or malformed JSON. Structured
 * outputs require `required` + `additionalProperties: false` on every object. */
const SELECTION_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    specialists: {
      type: "array",
      description: "The 2–5 most relevant specialists, most relevant first.",
      items: {
        type: "object",
        properties: {
          id: { type: "string", enum: SPECIALISTS.map((s) => s.id) },
          task: {
            type: "string",
            description: "One-line focus for this specialist.",
          },
        },
        required: ["id", "task"],
        additionalProperties: false,
      },
    },
  },
  required: ["specialists"],
  additionalProperties: false,
};

/** Per-specialist tool-loop cap: up to 3 calculator rounds, then the 4th call
 * forces a text answer via tool_choice none. */
const SPECIALIST_MAX_STEPS = 4;

type SpecialistRun = {
  text: string;
  /** Tool calls made along the way, surfaced as tool_activity after the
   * parallel batch completes (can't yield from inside Promise.all). */
  toolNotes: { tool: string; summary: string; isError?: boolean }[];
};

/**
 * One specialist consultation: a small non-streaming tool loop over the local
 * construction tools (calculators + save_memory), so a specialist can actually
 * compute quantities instead of guessing. Usage is reported per call via
 * onUsage so a failure elsewhere in the batch doesn't drop completed calls.
 */
async function runSpecialist(opts: {
  userId: string;
  conversationId: string;
  model: ModelInfo;
  effort: EffortLevel | null;
  baseSystem: string;
  persona: Specialist;
  task: string;
  message: string;
  attachments: Attachment[];
  onUsage: (u: UsageDelta) => void;
  signal?: AbortSignal;
}): Promise<SpecialistRun> {
  const content: Anthropic.ContentBlockParam[] = [];
  for (const a of opts.attachments) content.push(...attachmentBlocks(a));
  content.push({
    type: "text",
    text: `${opts.message}\n\nYour specific focus: ${opts.task}`,
  });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content }];

  // Cache breakpoint on the base prompt, which is identical across every
  // specialist this turn (and the tool defs before it are too, so the whole
  // prefix is shared); the persona rides after it as the volatile suffix.
  const system = buildSystemBlocks({
    stable: opts.baseSystem,
    volatile: `${opts.persona.prompt}\n\nStay strictly within your specialty. Be
concise and concrete. If something is outside your area, say so briefly rather than guessing. Use the
provided calculator tools for quantity/engineering math instead of estimating in your head.`,
  });
  // Tool defs come from lib/tools/local-tools with loose JSON schemas —
  // missing type: Anthropic.ToolUnion.
  const tools = localToolDefinitions() as unknown as Anthropic.ToolUnion[];

  const toolNotes: SpecialistRun["toolNotes"] = [];
  let text = "";
  for (let step = 0; step < SPECIALIST_MAX_STEPS; step++) {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: opts.model.id,
      max_tokens: 2000,
      system,
      messages,
      tools,
    };
    if (opts.model.adaptiveThinking) params.thinking = { type: "adaptive" };
    if (opts.effort) params.output_config = { effort: opts.effort };
    // Final step: force a text answer. The tools param must stay (earlier
    // turns reference them), so cut off further calls via tool_choice.
    if (step === SPECIALIST_MAX_STEPS - 1)
      params.tool_choice = { type: "none" };

    const msg = await anthropic().messages.create(
      params,
      opts.signal ? { signal: opts.signal } : undefined,
    );
    opts.onUsage({
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
      cacheCreationInputTokens: msg.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: msg.usage.cache_read_input_tokens ?? 0,
    });

    text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const toolUses = msg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (msg.stop_reason !== "tool_use" || toolUses.length === 0) break;

    // Echo the assistant turn back verbatim (thinking signatures intact),
    // then run each requested tool and return the results.
    messages.push({
      role: "assistant",
      content: msg.content as unknown as Anthropic.ContentBlockParam[],
    });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const r = await runLocalTool(
        opts.userId,
        tu.name,
        (tu.input ?? {}) as Record<string, unknown>,
      );
      await recordAudit({
        userId: opts.userId,
        action: `tool.${tu.name}`,
        detail: `${opts.persona.name}: ${r.summary}`,
        conversationId: opts.conversationId,
      });
      toolNotes.push({
        tool: tu.name,
        summary: `${opts.persona.name} · ${r.summary}`,
        isError: r.isError,
      });
      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: r.output,
        ...(r.isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: "user", content: results });
  }
  return { text, toolNotes };
}

/**
 * Multi-agent "Team" turn: a coordinator picks the relevant specialist personas
 * (schema-constrained structured output), each is consulted in parallel with
 * the local construction tools available, and a synthesizer streams one merged
 * response token-by-token. Yields activity + text events and persists the
 * final assistant message itself (like runAgentTurn).
 */
export async function* runOrchestration(opts: {
  userId: string;
  conversationId: string;
  model: string;
  effort: string;
  baseSystem: string;
  message: string;
  attachments?: Attachment[];
  signal?: AbortSignal;
}): AsyncGenerator<AgentEvent> {
  let inTok = 0;
  let outTok = 0;
  let cacheWriteTok = 0;
  let cacheReadTok = 0;
  const attachments = opts.attachments ?? [];
  const addUsage = (r: UsageDelta) => {
    inTok += r.inputTokens;
    outTok += r.outputTokens;
    cacheWriteTok += r.cacheCreationInputTokens;
    cacheReadTok += r.cacheReadInputTokens;
  };

  try {
    // 1. Coordinator picks specialists — mechanical routing runs on the cheap
    // model with a constrained output schema; specialists and the synthesizer
    // keep the requested model.
    const roster = SPECIALISTS.map((s) => `- ${s.id}: ${s.name} — ${s.role}`).join("\n");
    const coord = await generateStructured<{ specialists?: Selected[] }>({
      model: MECHANICAL_MODEL,
      effort: "low",
      system: `You are the orchestrator for a construction AI team. Given a user request, choose the
2–5 most relevant specialists from the roster and give each a one-line task.

Roster:
${roster}`,
      maxTokens: 500,
      turns: [{ role: "user", text: opts.message || "(see attached documents)" }],
      schema: SELECTION_SCHEMA,
      schemaName: "specialist_selection",
      signal: opts.signal,
    });
    // Metered separately under its own (cheap) model so the routing tokens
    // aren't billed at the requested model's price.
    await recordUsage({
      userId: opts.userId,
      model: coord.model,
      feature: "team",
      inputTokens: coord.inputTokens,
      outputTokens: coord.outputTokens,
      cacheCreationInputTokens: coord.cacheCreationInputTokens,
      cacheReadInputTokens: coord.cacheReadInputTokens,
    });

    let selected = (coord.data?.specialists ?? [])
      .filter((s) => getSpecialist(s.id))
      .slice(0, 5);
    if (selected.length === 0) {
      // Fallback: a sensible default trio.
      selected = [
        { id: "project_manager", task: "overall assessment" },
        { id: "estimator", task: "cost & quantity impact" },
        { id: "document_analyst", task: "facts from the documents" },
      ];
    }

    const names = selected.map((s) => getSpecialist(s.id)!.name);
    yield {
      type: "tool_activity",
      tool: "orchestrator",
      summary: `Assembling team: ${names.join(", ")}`,
    };

    // 2. Consult each specialist in parallel (each runs its own tool loop).
    const { model: specModel, effort: specEffort } = resolveModel(
      opts.model,
      opts.effort,
    );
    // Per-specialist try/catch so one voice failing (API error, timeout)
    // degrades to an empty contribution instead of rejecting the whole batch —
    // Promise.all then always awaits every specialist, so the finally block
    // meters after every onUsage callback has fired (no post-metering race).
    const results = await Promise.all(
      selected.map(async (sel) => {
        const spec = getSpecialist(sel.id)!;
        try {
          const r = await runSpecialist({
            userId: opts.userId,
            conversationId: opts.conversationId,
            model: specModel,
            effort: specEffort,
            baseSystem: opts.baseSystem,
            persona: spec,
            task: sel.task,
            message: opts.message,
            attachments,
            onUsage: addUsage,
            signal: opts.signal,
          });
          return { spec, ...r };
        } catch (err) {
          log.error("team.specialist_failed", err, { specialist: spec.id });
          return {
            spec,
            text: "",
            toolNotes: [
              {
                tool: "error",
                summary: `${spec.name} could not be reached`,
                isError: true,
              },
            ],
          };
        }
      }),
    );

    for (const r of results) {
      for (const note of r.toolNotes) {
        yield {
          type: "tool_activity",
          tool: note.tool,
          summary: note.summary,
          isError: note.isError,
        };
      }
      yield {
        type: "tool_activity",
        tool: r.spec.id,
        summary: `${r.spec.name} weighed in`,
      };
    }

    // 3. Synthesize — streamed so the integrated answer arrives token-by-token
    // instead of as one dump after a long silence.
    const panel = results
      .map((r) => `### ${r.spec.name}\n${r.text}`)
      .join("\n\n");
    const header = `**Team review — ${names.join(", ")}**\n\n`;
    yield { type: "text", text: header };

    let synthText = "";
    let failed = false;
    for await (const ev of streamChat({
      model: opts.model,
      effort: opts.effort,
      // Same cache split as the specialists: breakpoint on the shared base
      // prompt, synthesis instructions as the volatile suffix.
      system: {
        stable: opts.baseSystem,
        volatile: `You are the lead coordinator. Below is the user's request and each
specialist's input. Produce ONE integrated answer for the user: attribute key points to the relevant
specialist inline (e.g. "— Estimator"), explicitly reconcile any conflicts between specialists, and
end with a short "Recommended actions" list. Do not simply concatenate the inputs.`,
      },
      maxTokens: 4000,
      turns: [
        {
          role: "user",
          text: `USER REQUEST:\n${opts.message}\n\nSPECIALIST INPUT:\n${panel}`,
        },
      ],
      signal: opts.signal,
    })) {
      if (ev.type === "text") {
        synthText += ev.text;
        yield { type: "text", text: ev.text };
      } else if (ev.type === "thinking") {
        yield { type: "thinking", text: ev.text };
      } else if (ev.type === "done") {
        addUsage({
          inputTokens: ev.inputTokens,
          outputTokens: ev.outputTokens,
          cacheCreationInputTokens: ev.cacheCreationInputTokens ?? 0,
          cacheReadInputTokens: ev.cacheReadInputTokens ?? 0,
        });
      } else if (ev.type === "error") {
        yield { type: "error", message: ev.message, retryable: ev.retryable };
        failed = true;
      }
    }
    // Synthesis failed — don't persist a broken turn (metering runs in finally).
    if (failed) return;
    if (!synthText.trim()) {
      synthText = "(no synthesis)";
      yield { type: "text", text: synthText };
    }

    await appendMessage({
      conversationId: opts.conversationId,
      role: "assistant",
      blocks: [{ type: "text", text: header + synthText }],
      model: opts.model,
      inputTokens: inTok,
      outputTokens: outTok,
    });
    yield { type: "done", inputTokens: inTok, outputTokens: outTok };
  } catch (err) {
    yield {
      type: "error",
      message: err instanceof Error ? err.message : "Team run failed",
    };
  } finally {
    // Meter specialist/synthesizer usage exactly once — even when a mid-run
    // error means only some of the parallel calls completed.
    if (inTok || outTok || cacheWriteTok || cacheReadTok) {
      await recordUsage({
        userId: opts.userId,
        model: opts.model,
        feature: "team",
        inputTokens: inTok,
        outputTokens: outTok,
        cacheCreationInputTokens: cacheWriteTok,
        cacheReadInputTokens: cacheReadTok,
      });
    }
  }
}
