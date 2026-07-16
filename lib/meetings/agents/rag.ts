import { and, eq, ilike, inArray, or, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  projects,
  projectFiles,
  rfis,
  submittals,
  changeOrders,
  meetingEvents,
  meetingSessions,
} from "@/lib/db/schema";
import type { MeetingState } from "@/lib/db/schema";
import { escapeLike } from "@/lib/retrieval";
import { runAgent, objectSchema, text, type AgentContext } from "./base";

/**
 * Memory / RAG agent (spec §13). When the discussion references a drawing, spec,
 * RFI, submittal, vendor, or piece of equipment, it retrieves matching records
 * from the company's EXISTING knowledge (project files, RFIs, submittals, change
 * orders, and prior meetings) and surfaces them. No external vector store — this
 * reuses the platform's own construction records (see ARCHITECTURE.md Phase A).
 */
type RelatedKnowledge = NonNullable<MeetingState["relatedKnowledge"]>;

type Refs = { references?: { term?: string; refType?: string }[] };

const schema = objectSchema({
  references: {
    type: "array",
    items: objectSchema({
      term: { type: "string" },
      refType: {
        type: "string",
        enum: ["drawing", "spec", "rfi", "submittal", "vendor", "equipment"],
      },
    }),
  },
});

export async function runMemoryRagAgent(ctx: AgentContext): Promise<RelatedKnowledge> {
  const system = `You are the Memory/RAG agent for a general contractor. From the transcript,
extract concrete references to company knowledge worth looking up: drawings, specifications, RFIs,
submittals, vendors/subcontractors, and equipment/materials. Return only distinctive search terms
(names, numbers, titles) — not generic words.
Return STRICT JSON only: {"references":[{"term":"...","refType":"drawing|spec|rfi|submittal|vendor|equipment"}]}.`;

  const raw = await runAgent<Refs>({
    ctx,
    agent: "memory_rag",
    system,
    schema,
    model: ctx.liveModel,
    maxTokens: 700,
    user: `Transcript:\n${ctx.transcript}`,
  });

  const terms = Array.from(
    new Set((raw?.references ?? []).map((r) => text(r.term)).filter((t) => t.length >= 3)),
  ).slice(0, 12);
  if (terms.length === 0) return [];

  // Scope retrieval to projects owned by this user (mirrors how the rest of the
  // app scopes construction records).
  const ownedProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.ownerId, ctx.userId));
  const projectIds = ownedProjects.map((p) => p.id);

  const results: RelatedKnowledge = [];
  const seen = new Set<string>();
  const push = (item: RelatedKnowledge[number]) => {
    const key = `${item.source}:${item.label}`.toLowerCase();
    if (seen.has(key) || item.label.length === 0) return;
    seen.add(key);
    results.push(item);
  };

  for (const term of terms) {
    // Terms come from an LLM over meeting audio — escape LIKE wildcards so a
    // term like "100%" or "a_b" can't turn into an unintended broad match.
    const pattern = `%${escapeLike(term)}%`;

    if (projectIds.length) {
      const [files, rfiRows, subRows, coRows] = await Promise.all([
        db
          .select({ name: projectFiles.name })
          .from(projectFiles)
          .where(and(inArray(projectFiles.projectId, projectIds), ilike(projectFiles.name, pattern)))
          .limit(3),
        db
          .select({ subject: rfis.subject })
          .from(rfis)
          .where(
            and(
              inArray(rfis.projectId, projectIds),
              or(ilike(rfis.subject, pattern), ilike(rfis.question, pattern)),
            ),
          )
          .limit(3),
        db
          .select({ title: submittals.title })
          .from(submittals)
          .where(and(inArray(submittals.projectId, projectIds), ilike(submittals.title, pattern)))
          .limit(3),
        db
          .select({ title: changeOrders.title })
          .from(changeOrders)
          .where(and(inArray(changeOrders.projectId, projectIds), ilike(changeOrders.title, pattern)))
          .limit(3),
      ]);
      files.forEach((f) => push({ label: f.name, refType: "drawing", source: "project_file" }));
      rfiRows.forEach((r) => push({ label: r.subject, refType: "rfi", source: "rfi" }));
      subRows.forEach((s) => push({ label: s.title, refType: "submittal", source: "submittal" }));
      coRows.forEach((c) => push({ label: c.title, refType: "change_order", source: "change_order" }));
    }

    // Prior meetings in the same company that discussed this term.
    const priorEvents = await db
      .select({ title: meetingEvents.title, detail: meetingEvents.detail })
      .from(meetingEvents)
      .innerJoin(meetingSessions, eq(meetingEvents.meetingId, meetingSessions.id))
      .where(
        and(
          eq(meetingSessions.companyId, ctx.companyId),
          or(ilike(meetingEvents.title, pattern), ilike(meetingEvents.detail, pattern)),
        ),
      )
      .orderBy(desc(meetingEvents.createdAt))
      .limit(2);
    priorEvents.forEach((e) =>
      push({ label: e.title, detail: e.detail ?? undefined, refType: "prior_meeting", source: "meeting" }),
    );
  }

  return results.slice(0, 25);
}
