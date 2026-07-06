import { generate, generateStructured, extractJson } from "@/lib/claude/chat";
import { MEETING_MODEL } from "@/lib/claude/models";
import { recordUsage } from "@/lib/usage";
import type {
  MeetingEventType,
  MeetingPriority,
  MeetingRiskType,
} from "@/lib/db/schema";

/**
 * Shared plumbing for the Meeting Intelligence agents. Each agent is a small,
 * single-responsibility function that calls `runAgent` with its own system
 * prompt and JSON contract — this is the "many small agents, not one prompt"
 * architecture the spec requires (see docs/meeting-intelligence/ARCHITECTURE.md).
 */

export const EVENT_TYPES: MeetingEventType[] = [
  "project_update",
  "safety",
  "scheduling",
  "procurement",
  "budget",
  "equipment",
  "rfi",
  "submittal",
  "quality",
  "change_order",
  "client_request",
  "risk",
  "question",
  "action_item",
  "decision",
  "follow_up",
  "general",
];

export const RISK_TYPES: MeetingRiskType[] = [
  "safety",
  "schedule",
  "budget",
  "material",
  "design",
  "quality",
  "other",
];

export const PRIORITIES: MeetingPriority[] = ["low", "medium", "high"];

export const clampConfidence = (n: unknown) =>
  Math.max(0, Math.min(100, typeof n === "number" ? Math.round(n) : 70));
export const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
export const timestamp = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
export const eventType = (v: unknown): MeetingEventType =>
  EVENT_TYPES.includes(v as MeetingEventType) ? (v as MeetingEventType) : "general";
export const riskType = (v: unknown): MeetingRiskType =>
  RISK_TYPES.includes(v as MeetingRiskType) ? (v as MeetingRiskType) : "other";
export const priority = (v: unknown): MeetingPriority =>
  PRIORITIES.includes(v as MeetingPriority) ? (v as MeetingPriority) : "medium";

/**
 * Build a structured-outputs object schema: `additionalProperties: false` is
 * mandatory for the API's json_schema format, and every property is listed as
 * required so the model always emits the full shape (the coercion helpers
 * above tolerate empty/null values, so this stays permissive in practice).
 */
export const objectSchema = (
  properties: Record<string, unknown>,
): Record<string, unknown> => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/** Context every agent receives about the meeting under analysis. */
export type AgentContext = {
  userId: string;
  meetingId: string;
  companyId: string;
  projectId: string | null;
  meetingTitle: string;
  linkedProjectName: string | null;
  /** "Name (id)" lines for the tenant's known projects. */
  knownProjects: string;
  /** Full timestamped transcript. */
  transcript: string;
  /** Cheaper model for the high-frequency/live agents. */
  liveModel?: string;
};

/**
 * Run one agent: a single Claude call with a strict-JSON contract, usage
 * metered under a per-agent feature tag so cost is attributable per agent.
 * When a `schema` is provided the call goes through structured outputs
 * (generateStructured constrains decoding to the schema and falls back to
 * plain generation + extraction on any API rejection); without one it uses
 * the legacy prompt-only JSON path. Either way the per-agent coercion
 * helpers remain the safety net over the parsed result.
 */
export async function runAgent<T>(opts: {
  ctx: AgentContext;
  agent: string;
  system: string;
  user: string;
  model?: string;
  effort?: string;
  maxTokens?: number;
  /** JSON schema for the agent's output contract (see objectSchema). */
  schema?: Record<string, unknown>;
}): Promise<T | null> {
  const model = opts.model ?? MEETING_MODEL;
  const effort = opts.effort ?? "medium";
  const maxTokens = opts.maxTokens ?? 3000;
  const turns = [{ role: "user" as const, text: opts.user }];

  if (opts.schema) {
    const result = await generateStructured<T>({
      model,
      effort,
      system: opts.system,
      maxTokens,
      turns,
      schema: opts.schema,
      schemaName: opts.agent,
    });
    await recordUsage({
      userId: opts.ctx.userId,
      model: result.model,
      feature: `meeting.${opts.agent}`,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheCreationInputTokens: result.cacheCreationInputTokens,
      cacheReadInputTokens: result.cacheReadInputTokens,
    });
    return result.data;
  }

  const result = await generate({
    model,
    effort,
    system: opts.system,
    maxTokens,
    turns,
  });
  await recordUsage({
    userId: opts.ctx.userId,
    model: result.model,
    feature: `meeting.${opts.agent}`,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cacheCreationInputTokens: result.cacheCreationInputTokens,
    cacheReadInputTokens: result.cacheReadInputTokens,
  });
  return extractJson<T>(result.text);
}
