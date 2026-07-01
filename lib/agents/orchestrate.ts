import { generate, extractJson } from "@/lib/claude/chat";
import type { AgentEvent } from "@/lib/claude/agent";
import type { Attachment } from "@/lib/claude/types";
import { SPECIALISTS, getSpecialist } from "@/lib/agents/specialists";
import { appendMessage } from "@/lib/chat/branches";
import { recordUsage } from "@/lib/usage";

type Selected = { id: string; task: string };

/**
 * Multi-agent "Team" turn: a coordinator picks the relevant specialist personas,
 * each is consulted in parallel, and a synthesizer merges their input into one
 * response. Yields activity + text events and persists the final assistant
 * message itself (like runAgentTurn).
 */
export async function* runOrchestration(opts: {
  userId: string;
  conversationId: string;
  model: string;
  effort: string;
  baseSystem: string;
  message: string;
  attachments?: Attachment[];
}): AsyncGenerator<AgentEvent> {
  let inTok = 0;
  let outTok = 0;
  const attachments = opts.attachments ?? [];

  try {
    // 1. Coordinator picks specialists.
    const roster = SPECIALISTS.map((s) => `- ${s.id}: ${s.name} — ${s.role}`).join("\n");
    const coord = await generate({
      model: opts.model,
      effort: "low",
      system: `You are the orchestrator for a construction AI team. Given a user request, choose the
2–5 most relevant specialists from the roster and give each a one-line task. Output STRICT JSON only:
{"specialists":[{"id":"<roster id>","task":"<what to focus on>"}]}.

Roster:
${roster}`,
      maxTokens: 500,
      turns: [{ role: "user", text: opts.message || "(see attached documents)" }],
    });
    inTok += coord.inputTokens;
    outTok += coord.outputTokens;

    const parsed = extractJson<{ specialists?: Selected[] }>(coord.text);
    let selected = (parsed?.specialists ?? [])
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

    // 2. Consult each specialist in parallel.
    const results = await Promise.all(
      selected.map(async (sel) => {
        const spec = getSpecialist(sel.id)!;
        const r = await generate({
          model: opts.model,
          effort: opts.effort,
          system: `${opts.baseSystem}\n\n${spec.prompt}\n\nStay strictly within your specialty. Be
concise and concrete. If something is outside your area, say so briefly rather than guessing.`,
          maxTokens: 2000,
          turns: [
            {
              role: "user",
              text: `${opts.message}\n\nYour specific focus: ${sel.task}`,
              attachments,
            },
          ],
        });
        return { spec, text: r.text, usage: r };
      }),
    );

    for (const r of results) {
      inTok += r.usage.inputTokens;
      outTok += r.usage.outputTokens;
      yield {
        type: "tool_activity",
        tool: r.spec.id,
        summary: `${r.spec.name} weighed in`,
      };
    }

    // 3. Synthesize.
    const panel = results
      .map((r) => `### ${r.spec.name}\n${r.text}`)
      .join("\n\n");
    const synth = await generate({
      model: opts.model,
      effort: opts.effort,
      system: `${opts.baseSystem}\n\nYou are the lead coordinator. Below is the user's request and each
specialist's input. Produce ONE integrated answer for the user: attribute key points to the relevant
specialist inline (e.g. "— Estimator"), explicitly reconcile any conflicts between specialists, and
end with a short "Recommended actions" list. Do not simply concatenate the inputs.`,
      maxTokens: 4000,
      turns: [
        {
          role: "user",
          text: `USER REQUEST:\n${opts.message}\n\nSPECIALIST INPUT:\n${panel}`,
        },
      ],
    });
    inTok += synth.inputTokens;
    outTok += synth.outputTokens;

    const finalText =
      `**Team review — ${names.join(", ")}**\n\n` + (synth.text || "(no synthesis)");
    yield { type: "text", text: finalText };

    await appendMessage({
      conversationId: opts.conversationId,
      role: "assistant",
      blocks: [{ type: "text", text: finalText }],
      model: opts.model,
      inputTokens: inTok,
      outputTokens: outTok,
    });
    await recordUsage({
      userId: opts.userId,
      model: opts.model,
      feature: "team",
      inputTokens: inTok,
      outputTokens: outTok,
    });
    yield { type: "done", inputTokens: inTok, outputTokens: outTok };
  } catch (err) {
    yield {
      type: "error",
      message: err instanceof Error ? err.message : "Team run failed",
    };
  }
}
