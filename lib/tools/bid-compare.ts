import { generate, extractJson, type GenerateResult } from "@/lib/claude/chat";

export type BidVendor = { name: string; totalAmt: string; notes?: string };

export type BidAnalysisResult = {
  analysis: string;
  recommendation: string;
  usage: GenerateResult;
};

const SYSTEM = `You are a senior construction estimator comparing vendor bids/quotes.
Output a JSON object with two keys:
- "analysis": a thorough comparison of the bids including price ranges, notable differences,
  scope gaps, qualifications, and risk factors. Use clear formatting with \\n for newlines.
- "recommendation": a concise (2-4 sentence) recommendation on which bid to select and why,
  or what additional information is needed before awarding.
Be objective, specific, and professional.`;

export async function analyzeBids(opts: {
  title: string;
  trade?: string;
  projectName?: string;
  vendors: BidVendor[];
  model?: string;
  effort?: string;
}): Promise<BidAnalysisResult> {
  const ctx: string[] = [`Bid Package: ${opts.title}`];
  if (opts.trade) ctx.push(`Trade: ${opts.trade}`);
  if (opts.projectName) ctx.push(`Project: ${opts.projectName}`);
  ctx.push(`\nVendor Quotes:`);
  opts.vendors.forEach((v, i) => {
    ctx.push(`${i + 1}. ${v.name} — $${v.totalAmt}${v.notes ? ` (${v.notes})` : ""}`);
  });

  const usage = await generate({
    model: opts.model,
    effort: opts.effort ?? "high",
    system: SYSTEM,
    maxTokens: 3000,
    turns: [
      {
        role: "user",
        text: `Compare the following bids and provide analysis:\n\n${ctx.join("\n")}`,
      },
    ],
  });

  const parsed = extractJson<{ analysis?: string; recommendation?: string }>(usage.text);
  const analysis = parsed?.analysis ?? usage.text;
  const recommendation = parsed?.recommendation ?? "";
  return { analysis, recommendation, usage };
}
