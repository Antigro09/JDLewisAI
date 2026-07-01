import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  meetingActionItems,
  meetingDecisions,
  meetingEvents,
  meetingRisks,
  meetingSessions,
  projects,
  type AppUser,
  type MeetingEventType,
  type MeetingPriority,
  type MeetingRiskType,
  type MeetingState,
} from "@/lib/db/schema";
import { generate, extractJson } from "@/lib/claude/chat";
import { recordUsage } from "@/lib/usage";
import { loadMeetingBundle, transcriptText } from "@/lib/meetings/access";
import { meetingToMarkdown } from "@/lib/meetings/export";

type AnalysisJson = {
  state?: MeetingState;
  summary?: string;
  events?: {
    type?: MeetingEventType;
    title?: string;
    detail?: string;
    speakerLabel?: string;
    timestampMs?: number;
    confidence?: number;
  }[];
  actionItems?: {
    ownerName?: string;
    task?: string;
    priority?: MeetingPriority;
    dueDate?: string;
    status?: string;
    confidence?: number;
    sourceTimestampMs?: number;
  }[];
  decisions?: {
    decision?: string;
    reason?: string;
    supportingDiscussion?: string;
    approvedBy?: string;
    timestampMs?: number;
    confidence?: number;
  }[];
  risks?: {
    riskType?: MeetingRiskType;
    description?: string;
    severity?: MeetingPriority;
    mitigation?: string;
    confidence?: number;
    sourceTimestampMs?: number;
  }[];
};

const EVENT_TYPES: MeetingEventType[] = [
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
const RISK_TYPES: MeetingRiskType[] = [
  "safety",
  "schedule",
  "budget",
  "material",
  "design",
  "quality",
  "other",
];
const PRIORITIES: MeetingPriority[] = ["low", "medium", "high"];

const clampConfidence = (n: unknown) =>
  Math.max(0, Math.min(100, typeof n === "number" ? Math.round(n) : 70));
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const timestamp = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
const eventType = (v: unknown): MeetingEventType =>
  EVENT_TYPES.includes(v as MeetingEventType) ? (v as MeetingEventType) : "general";
const riskType = (v: unknown): MeetingRiskType =>
  RISK_TYPES.includes(v as MeetingRiskType) ? (v as MeetingRiskType) : "other";
const priority = (v: unknown): MeetingPriority =>
  PRIORITIES.includes(v as MeetingPriority) ? (v as MeetingPriority) : "medium";

export async function analyzeMeeting(user: AppUser, meetingId: string) {
  const bundle = await loadMeetingBundle(user, meetingId);
  if (!bundle) throw new Error("Meeting not found");
  const transcript = transcriptText(bundle.segments);
  if (!transcript.trim()) throw new Error("Add transcript segments before analysis.");

  const userProjects = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.ownerId, user.id));
  const projectList = userProjects.map((p) => `${p.name} (${p.id})`).join("\n") || "None";

  const system = `You are the Meeting Intelligence analysis graph for a general contractor.
Act as specialized agents: Project Detection, Conversation State, Action Item, Decision, Risk,
Safety, Scheduler, RAG triage, Memory, and QA. Return STRICT JSON only.

Classify discussion using these event types: ${EVENT_TYPES.join(", ")}.
Extract implied work assignments, decisions, risks, and live state. Use confidence 0-100.
Do not invent attendees, due dates, or approvals. If unknown, omit the field or use null-like empty strings.`;

  const result = await generate({
    model: "claude-sonnet-5",
    effort: "medium",
    system,
    maxTokens: 5000,
    turns: [
      {
        role: "user",
        text: `Known projects:\n${projectList}\n\nMeeting title: ${bundle.meeting.title}\nCurrent linked project: ${
          bundle.project?.name ?? "none"
        }\n\nTranscript:\n${transcript}\n\nReturn JSON with keys: state, summary, events, actionItems, decisions, risks.`,
      },
    ],
  });
  await recordUsage({
    userId: user.id,
    model: result.model,
    feature: "meeting_analysis",
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });

  const parsed = extractJson<AnalysisJson>(result.text) ?? {};
  await Promise.all([
    db.delete(meetingEvents).where(eq(meetingEvents.meetingId, meetingId)),
    db.delete(meetingActionItems).where(eq(meetingActionItems.meetingId, meetingId)),
    db.delete(meetingDecisions).where(eq(meetingDecisions.meetingId, meetingId)),
    db.delete(meetingRisks).where(eq(meetingRisks.meetingId, meetingId)),
  ]);

  const projectId = bundle.meeting.projectId;
  const events = (parsed.events ?? [])
    .map((e) => ({
      meetingId,
      projectId,
      type: eventType(e.type),
      title: text(e.title) || "Meeting note",
      detail: text(e.detail) || null,
      speakerLabel: text(e.speakerLabel) || null,
      timestampMs: timestamp(e.timestampMs),
      confidence: clampConfidence(e.confidence),
    }))
    .filter((e) => e.title);
  const actionItems = (parsed.actionItems ?? [])
    .map((a) => ({
      meetingId,
      projectId,
      ownerName: text(a.ownerName) || null,
      task: text(a.task),
      priority: priority(a.priority),
      dueDate: text(a.dueDate) || null,
      status: text(a.status) || "open",
      confidence: clampConfidence(a.confidence),
      sourceTimestampMs: timestamp(a.sourceTimestampMs),
    }))
    .filter((a) => a.task);
  const decisions = (parsed.decisions ?? [])
    .map((d) => ({
      meetingId,
      projectId,
      decision: text(d.decision),
      reason: text(d.reason) || null,
      supportingDiscussion: text(d.supportingDiscussion) || null,
      approvedBy: text(d.approvedBy) || null,
      timestampMs: timestamp(d.timestampMs),
      confidence: clampConfidence(d.confidence),
    }))
    .filter((d) => d.decision);
  const risks = (parsed.risks ?? [])
    .map((r) => ({
      meetingId,
      projectId,
      riskType: riskType(r.riskType),
      description: text(r.description),
      severity: priority(r.severity),
      mitigation: text(r.mitigation) || null,
      confidence: clampConfidence(r.confidence),
      sourceTimestampMs: timestamp(r.sourceTimestampMs),
    }))
    .filter((r) => r.description);

  if (events.length) await db.insert(meetingEvents).values(events);
  if (actionItems.length) await db.insert(meetingActionItems).values(actionItems);
  if (decisions.length) await db.insert(meetingDecisions).values(decisions);
  if (risks.length) await db.insert(meetingRisks).values(risks);

  const state: MeetingState = {
    ...(parsed.state ?? {}),
    currentProjectId: projectId,
    confidence: clampConfidence(parsed.state?.confidence),
    updatedAt: new Date().toISOString(),
  };
  await db
    .update(meetingSessions)
    .set({
      state,
      summary: text(parsed.summary) || null,
      updatedAt: new Date(),
    })
    .where(eq(meetingSessions.id, meetingId));

  return { events, actionItems, decisions, risks, state, summary: text(parsed.summary) };
}

export async function generateMeetingMinutes(user: AppUser, meetingId: string) {
  const bundle = await loadMeetingBundle(user, meetingId);
  if (!bundle) throw new Error("Meeting not found");
  const transcript = transcriptText(bundle.segments);
  if (!transcript.trim()) throw new Error("Add transcript segments before generating minutes.");

  const draftMarkdown = meetingToMarkdown(bundle);
  const system = `You are the Meeting Minutes Agent and QA Agent for a construction company.
Generate professional meeting minutes in company format. Verify missing attendees, missing projects,
missing action items, missing decisions, duplicate information, consistent formatting, and professional language.
Return STRICT JSON only: {"minutesMarkdown":"...","qaNotes":["..."]}.`;

  const result = await generate({
    model: "claude-sonnet-5",
    effort: "medium",
    system,
    maxTokens: 5000,
    turns: [
      {
        role: "user",
        text: `Use this structured meeting intelligence and transcript to generate final minutes.\n\nSTRUCTURED DRAFT:\n${draftMarkdown}\n\nTRANSCRIPT:\n${transcript}`,
      },
    ],
  });
  await recordUsage({
    userId: user.id,
    model: result.model,
    feature: "meeting_minutes",
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });

  const parsed = extractJson<{ minutesMarkdown?: string; qaNotes?: string[] }>(result.text);
  const minutesMarkdown = text(parsed?.minutesMarkdown) || draftMarkdown;
  const qaNotes = Array.isArray(parsed?.qaNotes)
    ? parsed!.qaNotes.map((n) => text(n)).filter(Boolean)
    : [];

  await db
    .update(meetingSessions)
    .set({
      minutesMarkdown,
      qaNotes,
      status: "complete",
      updatedAt: new Date(),
    })
    .where(eq(meetingSessions.id, meetingId));

  return { minutesMarkdown, qaNotes };
}
