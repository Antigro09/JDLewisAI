import { generateStructured, type GenerateResult } from "@/lib/claude/chat";

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

/** Enforced via structured outputs — mirrors the two keys in SYSTEM. */
const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    analysis: { type: "string" },
    recommendation: { type: "string" },
  },
  required: ["analysis", "recommendation"],
  additionalProperties: false,
};

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

  const { data, ...meta } = await generateStructured<{
    analysis?: string;
    recommendation?: string;
  }>({
    model: opts.model,
    effort: opts.effort ?? "high",
    system: SYSTEM,
    maxTokens: 3000,
    schema: ANALYSIS_SCHEMA,
    schemaName: "bid_analysis",
    turns: [
      {
        role: "user",
        text: `Compare the following bids and provide analysis:\n\n${ctx.join("\n")}`,
      },
    ],
  });
  // Structured path returns parsed data, not raw text — keep the GenerateResult
  // shape callers meter against.
  const usage: GenerateResult = { text: "", ...meta };

  const analysis = typeof data?.analysis === "string" ? data.analysis : "";
  const recommendation = typeof data?.recommendation === "string" ? data.recommendation : "";
  return { analysis, recommendation, usage };
}
