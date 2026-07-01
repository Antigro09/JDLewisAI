import { generate, extractJson } from "@/lib/claude/chat";
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
 */
export async function runAgent<T>(opts: {
  ctx: AgentContext;
  agent: string;
  system: string;
  user: string;
  model?: string;
  effort?: string;
  maxTokens?: number;
}): Promise<T | null> {
  const result = await generate({
    model: opts.model ?? "claude-sonnet-5",
    effort: opts.effort ?? "medium",
    system: opts.system,
    maxTokens: opts.maxTokens ?? 3000,
    turns: [{ role: "user", text: opts.user }],
  });
  await recordUsage({
    userId: opts.ctx.userId,
    model: result.model,
    feature: `meeting.${opts.agent}`,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });
  return extractJson<T>(result.text);
}
