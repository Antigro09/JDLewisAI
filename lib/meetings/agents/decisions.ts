import {
  runAgent,
  objectSchema,
  text,
  clampConfidence,
  timestamp,
  type AgentContext,
} from "./base";

/**
 * Decision agent (spec §10). Captures agreements reached by the team, with the
 * reasoning, supporting discussion, who approved, and when.
 */
export type ExtractedDecision = {
  decision: string;
  reason: string | null;
  supportingDiscussion: string | null;
  approvedBy: string | null;
  timestampMs: number;
  confidence: number;
};

type Raw = {
  decisions?: {
    decision?: string;
    reason?: string;
    supportingDiscussion?: string;
    approvedBy?: string;
    timestampMs?: number;
    confidence?: number;
  }[];
};

const schema = objectSchema({
  decisions: {
    type: "array",
    items: objectSchema({
      decision: { type: "string" },
      reason: { type: ["string", "null"] },
      supportingDiscussion: { type: ["string", "null"] },
      approvedBy: { type: ["string", "null"] },
      timestampMs: { type: "number" },
      confidence: { type: "integer" },
    }),
  },
});

export async function runDecisionAgent(ctx: AgentContext): Promise<ExtractedDecision[]> {
  const system = `You are the Decision agent for a general contractor. Whenever the team reaches an
agreement or makes a call, record it: decision, reason, supportingDiscussion (a short quote/paraphrase
of the exchange), approvedBy (who made/approved it, or null), timestampMs (the [Ns] marker × 1000),
confidence 0-100. Only record real decisions — not open questions. Do not invent approvers.
Return STRICT JSON only: {"decisions":[{...}]}.`;

  const raw = await runAgent<Raw>({
    ctx,
    agent: "decisions",
    system,
    schema,
    maxTokens: 2000,
    user: `Transcript:\n${ctx.transcript}`,
  });

  return (raw?.decisions ?? [])
    .map((d) => ({
      decision: text(d.decision),
      reason: text(d.reason) || null,
      supportingDiscussion: text(d.supportingDiscussion) || null,
      approvedBy: text(d.approvedBy) || null,
      timestampMs: timestamp(d.timestampMs),
      confidence: clampConfidence(d.confidence),
    }))
    .filter((d) => d.decision);
}
