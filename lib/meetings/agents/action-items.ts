import type { MeetingPriority } from "@/lib/db/schema";
import { runAgent, text, priority, clampConfidence, timestamp, type AgentContext } from "./base";

/**
 * Action Item agent (spec §9). Extracts explicit AND implied work assignments,
 * each with owner / task / priority / due date / status / confidence.
 */
export type ExtractedActionItem = {
  ownerName: string | null;
  task: string;
  priority: MeetingPriority;
  dueDate: string | null;
  status: string;
  confidence: number;
  sourceTimestampMs: number;
};

type Raw = {
  actionItems?: {
    ownerName?: string;
    task?: string;
    priority?: string;
    dueDate?: string;
    status?: string;
    confidence?: number;
    sourceTimestampMs?: number;
  }[];
};

export async function runActionItemAgent(ctx: AgentContext): Promise<ExtractedActionItem[]> {
  const system = `You are the Action Item agent for a general contractor. Extract every task that
someone is expected to do. Capture BOTH explicit ("I'll send the RFI") and IMPLIED assignments
("someone needs to chase the steel submittal" → infer the likely owner, or leave owner null with
lower confidence). For each: ownerName, task, priority (low|medium|high), dueDate (as spoken or
null — never invent a date), status (default "open"), confidence 0-100, sourceTimestampMs (the
[Ns] marker in seconds × 1000). Do not fabricate owners or dates.
Return STRICT JSON only: {"actionItems":[{...}]}.`;

  const raw = await runAgent<Raw>({
    ctx,
    agent: "action_items",
    system,
    maxTokens: 2500,
    user: `Transcript:\n${ctx.transcript}`,
  });

  return (raw?.actionItems ?? [])
    .map((a) => ({
      ownerName: text(a.ownerName) || null,
      task: text(a.task),
      priority: priority(a.priority),
      dueDate: text(a.dueDate) || null,
      status: text(a.status) || "open",
      confidence: clampConfidence(a.confidence),
      sourceTimestampMs: timestamp(a.sourceTimestampMs),
    }))
    .filter((a) => a.task);
}
