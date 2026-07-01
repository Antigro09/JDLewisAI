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
  type MeetingState,
} from "@/lib/db/schema";
import { loadMeetingBundle, transcriptText } from "@/lib/meetings/access";
import { meetingToMarkdown } from "@/lib/meetings/export";
import { createNotification } from "@/lib/notifications";
import { truncate } from "@/lib/utils";
import { text, clampConfidence, type AgentContext } from "./base";
import { runClassifierAgent } from "./classifier";
import { runProjectDetectionAgent } from "./project";
import { runEventsAgent, type ExtractedEvent } from "./events";
import { runActionItemAgent, type ExtractedActionItem } from "./action-items";
import { runDecisionAgent, type ExtractedDecision } from "./decisions";
import { runRiskAgent, type ExtractedRisk } from "./risks";
import { runMemoryRagAgent } from "./rag";
import { runMinutesAgent, runQaAgent } from "./minutes";

const LIVE_MODEL = "claude-haiku-4-5-20251001";

// Categories that warrant waking the (more expensive) specialist agents.
const RISK_CATEGORIES: MeetingEventType[] = [
  "risk",
  "safety",
  "budget",
  "scheduling",
  "quality",
  "change_order",
];
const RAG_CATEGORIES: MeetingEventType[] = [
  "rfi",
  "submittal",
  "equipment",
  "procurement",
  "quality",
  "project_update",
];

function intersects(a: MeetingEventType[], b: MeetingEventType[]) {
  return a.some((x) => b.includes(x));
}

async function buildContext(user: AppUser, meetingId: string) {
  const bundle = await loadMeetingBundle(user, meetingId);
  if (!bundle) throw new Error("Meeting not found");
  const transcript = transcriptText(bundle.segments);
  if (!transcript.trim()) throw new Error("Add transcript segments before analysis.");

  const userProjects = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.ownerId, user.id));
  const knownProjects =
    userProjects.map((p) => `${p.name} (${p.id})`).join("\n") || "None";

  const ctx: AgentContext = {
    userId: user.id,
    meetingId,
    companyId: bundle.meeting.companyId,
    projectId: bundle.meeting.projectId,
    meetingTitle: bundle.meeting.title,
    linkedProjectName: bundle.project?.name ?? null,
    knownProjects,
    transcript,
    liveModel: LIVE_MODEL,
  };
  return { bundle, ctx, knownProjectIds: userProjects.map((p) => p.id) };
}

/**
 * Planner (spec §6): runs the modular agent graph. Classifier first, then gates
 * and runs the specialist agents in parallel, consolidates, and persists. This
 * replaces the previous single-prompt analyzer.
 */
export async function analyzeMeeting(user: AppUser, meetingId: string) {
  const { bundle, ctx, knownProjectIds } = await buildContext(user, meetingId);

  // Step 1 — understand the conversation (cheap, drives routing).
  const classification = await runClassifierAgent(ctx);
  const runRisks = intersects(classification.categories, RISK_CATEGORIES);
  const runRag = intersects(classification.categories, RAG_CATEGORIES);

  // Step 2 — run the gated specialists in parallel.
  const [detection, events, actionItemsRaw, decisionsRaw, risksRaw, related] =
    await Promise.all([
      runProjectDetectionAgent(ctx),
      runEventsAgent(ctx),
      runActionItemAgent(ctx),
      runDecisionAgent(ctx),
      runRisks ? runRiskAgent(ctx) : Promise.resolve<ExtractedRisk[]>([]),
      runRag ? runMemoryRagAgent(ctx) : Promise.resolve([]),
    ]);

  // Resolve the project: a detected, known project wins; else keep the link.
  const detectedId =
    detection.matchedProjectId && knownProjectIds.includes(detection.matchedProjectId)
      ? detection.matchedProjectId
      : null;
  const projectId = detectedId ?? bundle.meeting.projectId;
  if (detectedId && detectedId !== bundle.meeting.projectId) {
    await db
      .update(meetingSessions)
      .set({ projectId: detectedId })
      .where(eq(meetingSessions.id, meetingId));
  }

  // Step 3 — persist (replace prior analysis for this meeting).
  await Promise.all([
    db.delete(meetingEvents).where(eq(meetingEvents.meetingId, meetingId)),
    db.delete(meetingActionItems).where(eq(meetingActionItems.meetingId, meetingId)),
    db.delete(meetingDecisions).where(eq(meetingDecisions.meetingId, meetingId)),
    db.delete(meetingRisks).where(eq(meetingRisks.meetingId, meetingId)),
  ]);

  const eventRows = events.map((e: ExtractedEvent) => ({ meetingId, projectId, ...e }));
  const actionRows = actionItemsRaw.map((a: ExtractedActionItem) => ({
    meetingId,
    projectId,
    ...a,
  }));
  const decisionRows = decisionsRaw.map((d: ExtractedDecision) => ({
    meetingId,
    projectId,
    ...d,
  }));
  const riskRows = risksRaw.map((r: ExtractedRisk) => ({ meetingId, projectId, ...r }));

  if (eventRows.length) await db.insert(meetingEvents).values(eventRows);
  if (actionRows.length) await db.insert(meetingActionItems).values(actionRows);
  if (decisionRows.length) await db.insert(meetingDecisions).values(decisionRows);
  if (riskRows.length) await db.insert(meetingRisks).values(riskRows);

  // Step 4 — consolidated live meeting state (spec §5).
  const summary = classification.gist || null;
  const state: MeetingState = {
    currentProjectId: projectId,
    currentProject: detection.projectName || bundle.project?.name || undefined,
    currentTopic: classification.currentTopic || undefined,
    meetingStage: classification.meetingStage,
    categories: classification.categories,
    currentRisks: riskRows.slice(0, 5).map((r) => r.description),
    currentActionItems: actionRows.slice(0, 5).map((a) => a.task),
    currentDecisions: decisionRows.slice(0, 5).map((d) => d.decision),
    relatedKnowledge: related.length ? related : undefined,
    confidence: clampConfidence(classification.confidence),
    updatedAt: new Date().toISOString(),
  };
  await db
    .update(meetingSessions)
    .set({ state, summary, updatedAt: new Date() })
    .where(eq(meetingSessions.id, meetingId));

  // Close the loop: flag high-severity risks to the meeting owner (spec §11).
  const highRisks = riskRows.filter((r) => r.severity === "high");
  if (highRisks.length) {
    try {
      await createNotification({
        userId: bundle.meeting.ownerId,
        kind: "error",
        title: `${highRisks.length} high-priority risk${highRisks.length > 1 ? "s" : ""} in ${bundle.meeting.title}`,
        body: truncate(highRisks.map((r) => r.description).join("; "), 300),
        link: `/meetings/${meetingId}`,
      });
    } catch {
      // notifications are best-effort
    }
  }

  return {
    events: eventRows,
    actionItems: actionRows,
    decisions: decisionRows,
    risks: riskRows,
    state,
    summary: text(summary),
    categories: classification.categories,
    relatedKnowledge: related,
  };
}

/**
 * Minutes pipeline (spec §14): Planner assembles the brief → Minutes agent →
 * QA agent. Two distinct agents, not one prompt.
 */
export async function generateMeetingMinutes(user: AppUser, meetingId: string) {
  const { bundle, ctx } = await buildContext(user, meetingId);
  const structuredBrief = meetingToMarkdown(bundle);

  const draft = await runMinutesAgent(ctx, structuredBrief);
  const { minutesMarkdown, qaNotes } = await runQaAgent(
    ctx,
    draft || structuredBrief,
    structuredBrief,
  );

  await db
    .update(meetingSessions)
    .set({ minutesMarkdown, qaNotes, status: "complete", updatedAt: new Date() })
    .where(eq(meetingSessions.id, meetingId));

  return { minutesMarkdown, qaNotes };
}
