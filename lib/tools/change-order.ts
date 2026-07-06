import { generateStructured, type GenerateResult } from "@/lib/claude/chat";

export type ChangeOrderDraftResult = {
  draft: string;
  usage: GenerateResult;
};

const SYSTEM = `You are a senior construction project manager drafting a formal Change Order.
Output a JSON object with a single key "draft" containing the full change order document as
a well-formatted string (use \\n for newlines). Include:
- Change Order header (number, project, date, contractor/owner if known)
- Description of change
- Reason / justification
- Cost impact (if provided, otherwise state TBD)
- Schedule impact (if provided, otherwise state TBD)
- Approval signature lines
Be thorough but concise. Use professional construction contract language.`;

/** Enforced via structured outputs — the draft is the whole payload. */
const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    draft: { type: "string" },
  },
  required: ["draft"],
  additionalProperties: false,
};

export async function generateChangeOrderDraft(opts: {
  title: string;
  description: string;
  reason?: string;
  costImpact?: string;
  scheduleImpact?: string;
  projectName?: string;
  coNumber?: string;
  model?: string;
  effort?: string;
}): Promise<ChangeOrderDraftResult> {
  const ctx: string[] = [`Change Order Title: ${opts.title}`];
  if (opts.coNumber) ctx.push(`CO Number: ${opts.coNumber}`);
  if (opts.projectName) ctx.push(`Project: ${opts.projectName}`);
  ctx.push(`Description of Change:\n${opts.description}`);
  if (opts.reason) ctx.push(`Reason / Justification:\n${opts.reason}`);
  if (opts.costImpact) ctx.push(`Cost Impact: ${opts.costImpact}`);
  if (opts.scheduleImpact) ctx.push(`Schedule Impact: ${opts.scheduleImpact}`);

  const { data, ...meta } = await generateStructured<{ draft?: string }>({
    model: opts.model,
    effort: opts.effort ?? "medium",
    system: SYSTEM,
    maxTokens: 2000,
    schema: DRAFT_SCHEMA,
    schemaName: "change_order_draft",
    turns: [
      {
        role: "user",
        text: `Draft a Change Order for:\n\n${ctx.join("\n")}`,
      },
    ],
  });
  // Structured path returns parsed data, not raw text — keep the GenerateResult
  // shape callers meter against.
  const usage: GenerateResult = { text: "", ...meta };

  // Empty only if even generateStructured's fallback ladder produced nothing.
  const draft = typeof data?.draft === "string" ? data.draft : "";
  return { draft, usage };
}
