import type { MeetingEventType } from "@/lib/db/schema";
import { runAgent, eventType, text, clampConfidence, EVENT_TYPES, type AgentContext } from "./base";

/**
 * Conversation / Classifier agent (spec §7). Understands the discussion rather
 * than summarizing it: tags which categories are present, the current topic and
 * meeting stage, and a one-line gist. Its output lets the Planner gate which
 * heavier specialists run.
 */
export type ClassifierResult = {
  categories: MeetingEventType[];
  currentTopic: string;
  meetingStage: string;
  gist: string;
  confidence: number;
};

type Raw = {
  categories?: string[];
  currentTopic?: string;
  meetingStage?: string;
  gist?: string;
  confidence?: number;
};

export async function runClassifierAgent(ctx: AgentContext): Promise<ClassifierResult> {
  const system = `You are the Conversation Classifier agent for a general contractor's Meeting
Intelligence system. Understand the discussion; do not summarize line by line.
Classify which of these categories are present: ${EVENT_TYPES.join(", ")}.
Also identify the current topic, the meeting stage (e.g. "opening", "project review",
"safety", "scheduling", "action review", "wrap-up"), and a one-sentence gist.
Return STRICT JSON only: {"categories":[...],"currentTopic":"...","meetingStage":"...","gist":"...","confidence":0-100}.`;

  const raw = await runAgent<Raw>({
    ctx,
    agent: "classifier",
    system,
    model: ctx.liveModel,
    maxTokens: 800,
    user: `Meeting: ${ctx.meetingTitle}\n\nTranscript:\n${ctx.transcript}`,
  });

  const categories = Array.from(
    new Set((raw?.categories ?? []).map(eventType)),
  ).filter((c) => c !== "general");
  return {
    categories: categories.length ? categories : ["general"],
    currentTopic: text(raw?.currentTopic),
    meetingStage: text(raw?.meetingStage) || "in progress",
    gist: text(raw?.gist),
    confidence: clampConfidence(raw?.confidence),
  };
}
