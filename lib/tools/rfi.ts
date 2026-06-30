import { generate, extractJson, type GenerateResult } from "@/lib/claude/chat";

export type RfiDraftResult = {
  draft: string;
  usage: GenerateResult;
};

const SYSTEM = `You are a senior construction project manager drafting a formal RFI
(Request for Information). Write a clear, professional RFI response or clarification
request. Output a JSON object with a single key "draft" containing the full RFI text
as a well-formatted string (use \\n for newlines). The draft should include:
- RFI header section (number, subject, date, from/to if known)
- Clear question or issue description
- Reference to relevant drawing/spec sections if mentioned
- Requested action or response
Keep it concise and professional.`;

export async function generateRfiDraft(opts: {
  subject: string;
  question: string;
  discipline?: string;
  projectName?: string;
  rfiNumber?: string;
  model?: string;
  effort?: string;
}): Promise<RfiDraftResult> {
  const ctx: string[] = [`Subject: ${opts.subject}`];
  if (opts.rfiNumber) ctx.push(`RFI Number: ${opts.rfiNumber}`);
  if (opts.projectName) ctx.push(`Project: ${opts.projectName}`);
  if (opts.discipline) ctx.push(`Discipline: ${opts.discipline}`);
  ctx.push(`Question/Issue:\n${opts.question}`);

  const usage = await generate({
    model: opts.model,
    effort: opts.effort ?? "medium",
    system: SYSTEM,
    maxTokens: 2000,
    turns: [
      {
        role: "user",
        text: `Generate an RFI draft for:\n\n${ctx.join("\n")}`,
      },
    ],
  });

  const parsed = extractJson<{ draft?: string }>(usage.text);
  const draft = parsed?.draft ?? usage.text;
  return { draft, usage };
}
