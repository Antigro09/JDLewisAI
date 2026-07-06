import type { MeetingEventType } from "@/lib/db/schema";
import {
  runAgent,
  objectSchema,
  text,
  eventType,
  clampConfidence,
  timestamp,
  EVENT_TYPES,
  type AgentContext,
} from "./base";

/**
 * Discussion-timeline agent. Turns the conversation into a sequence of notable,
 * classified discussion points (spec §7 categories) for the meeting timeline —
 * distinct from the extraction agents which pull out actionable items.
 */
export type ExtractedEvent = {
  type: MeetingEventType;
  title: string;
  detail: string | null;
  speakerLabel: string | null;
  timestampMs: number;
  confidence: number;
};

type Raw = {
  events?: {
    type?: string;
    title?: string;
    detail?: string;
    speakerLabel?: string;
    timestampMs?: number;
    confidence?: number;
  }[];
};

const schema = objectSchema({
  events: {
    type: "array",
    items: objectSchema({
      type: { type: "string", enum: EVENT_TYPES },
      title: { type: "string" },
      detail: { type: ["string", "null"] },
      speakerLabel: { type: ["string", "null"] },
      timestampMs: { type: "number" },
      confidence: { type: "integer" },
    }),
  },
});

export async function runEventsAgent(ctx: AgentContext): Promise<ExtractedEvent[]> {
  const system = `You are the meeting timeline agent for a general contractor. Break the discussion
into notable points, each classified as one of: ${EVENT_TYPES.join(", ")}. For each: a short title,
optional detail, the speaker label if identifiable, timestampMs (the [Ns] marker × 1000), and
confidence 0-100. Aim for the meaningful beats, not every sentence.
Return STRICT JSON only: {"events":[{...}]}.`;

  const raw = await runAgent<Raw>({
    ctx,
    agent: "events",
    system,
    schema,
    maxTokens: 2500,
    user: `Transcript:\n${ctx.transcript}`,
  });

  return (raw?.events ?? [])
    .map((e) => ({
      type: eventType(e.type),
      title: text(e.title) || "Meeting note",
      detail: text(e.detail) || null,
      speakerLabel: text(e.speakerLabel) || null,
      timestampMs: timestamp(e.timestampMs),
      confidence: clampConfidence(e.confidence),
    }))
    .filter((e) => e.title);
}
