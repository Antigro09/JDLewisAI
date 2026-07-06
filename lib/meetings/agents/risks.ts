import type { MeetingRiskType, MeetingPriority } from "@/lib/db/schema";
import {
  runAgent,
  objectSchema,
  text,
  riskType,
  priority,
  clampConfidence,
  timestamp,
  RISK_TYPES,
  PRIORITIES,
  type AgentContext,
} from "./base";

/**
 * Risk agent (spec §11) — also covers the Safety agent's concern by typing
 * safety risks explicitly and raising their severity. Identifies safety /
 * schedule / budget / material / design / quality risks and flags high ones.
 */
export type ExtractedRisk = {
  riskType: MeetingRiskType;
  description: string;
  severity: MeetingPriority;
  mitigation: string | null;
  confidence: number;
  sourceTimestampMs: number;
};

type Raw = {
  risks?: {
    riskType?: string;
    description?: string;
    severity?: string;
    mitigation?: string;
    confidence?: number;
    sourceTimestampMs?: number;
  }[];
};

const schema = objectSchema({
  risks: {
    type: "array",
    items: objectSchema({
      riskType: { type: "string", enum: RISK_TYPES },
      description: { type: "string" },
      severity: { type: "string", enum: PRIORITIES },
      mitigation: { type: ["string", "null"] },
      confidence: { type: "integer" },
      sourceTimestampMs: { type: "number" },
    }),
  },
});

export async function runRiskAgent(ctx: AgentContext): Promise<ExtractedRisk[]> {
  const system = `You are the combined Risk and Safety agent for a general contractor. Identify
risks raised or implied in the meeting and type each one: safety, schedule, budget, material,
design, quality, or other. Treat anything affecting worker safety as riskType "safety" with
elevated severity. For each: description, severity (low|medium|high), mitigation (if discussed,
else null), confidence 0-100, sourceTimestampMs (the [Ns] marker × 1000). Flag genuine hazards as
high severity. Do not invent risks that were not discussed.
Return STRICT JSON only: {"risks":[{...}]}.`;

  const raw = await runAgent<Raw>({
    ctx,
    agent: "risks",
    system,
    schema,
    maxTokens: 2000,
    user: `Transcript:\n${ctx.transcript}`,
  });

  return (raw?.risks ?? [])
    .map((r) => ({
      riskType: riskType(r.riskType),
      description: text(r.description),
      severity: priority(r.severity),
      mitigation: text(r.mitigation) || null,
      confidence: clampConfidence(r.confidence),
      sourceTimestampMs: timestamp(r.sourceTimestampMs),
    }))
    .filter((r) => r.description);
}
