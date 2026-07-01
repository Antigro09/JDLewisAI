import { NextResponse } from "next/server";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  meetingEvents,
  meetingSessions,
  transcriptSegments,
} from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/server";
import { ensureCompanyForUser } from "@/lib/meetings/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Meeting memory search (spec §12). Ranked Postgres full-text search over
 * transcripts and extracted events, with a substring (ILIKE) fallback so exact
 * tokens like "RFI-014" or a person's name still match. Company-scoped.
 * (pgvector semantic search is the Phase C upgrade — see ARCHITECTURE.md.)
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { query?: string };
  try {
    body = (await req.json()) as { query?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const query = (body.query ?? "").trim();
  if (!query) return NextResponse.json({ error: "Query required" }, { status: 400 });
  const company = await ensureCompanyForUser(user);
  const pattern = `%${query}%`;
  const tsquery = sql`websearch_to_tsquery('english', ${query})`;

  const segVector = sql`to_tsvector('english', ${transcriptSegments.text})`;
  const transcriptMatches = await db
    .select({
      meetingId: meetingSessions.id,
      meetingTitle: meetingSessions.title,
      speaker: transcriptSegments.speakerName,
      speakerLabel: transcriptSegments.speakerLabel,
      text: transcriptSegments.text,
      createdAt: transcriptSegments.createdAt,
      rank: sql<number>`ts_rank(${segVector}, ${tsquery})`,
    })
    .from(transcriptSegments)
    .innerJoin(meetingSessions, eq(transcriptSegments.meetingId, meetingSessions.id))
    .where(
      and(
        eq(meetingSessions.companyId, company.id),
        or(sql`${segVector} @@ ${tsquery}`, ilike(transcriptSegments.text, pattern)),
      ),
    )
    .orderBy(desc(sql`ts_rank(${segVector}, ${tsquery})`), desc(transcriptSegments.createdAt))
    .limit(25);

  const eventVector = sql`to_tsvector('english', ${meetingEvents.title} || ' ' || coalesce(${meetingEvents.detail}, ''))`;
  const eventMatches = await db
    .select({
      meetingId: meetingSessions.id,
      meetingTitle: meetingSessions.title,
      type: meetingEvents.type,
      text: meetingEvents.title,
      detail: meetingEvents.detail,
      createdAt: meetingEvents.createdAt,
      rank: sql<number>`ts_rank(${eventVector}, ${tsquery})`,
    })
    .from(meetingEvents)
    .innerJoin(meetingSessions, eq(meetingEvents.meetingId, meetingSessions.id))
    .where(
      and(
        eq(meetingSessions.companyId, company.id),
        or(
          sql`${eventVector} @@ ${tsquery}`,
          ilike(meetingEvents.title, pattern),
          ilike(meetingEvents.detail, pattern),
        ),
      ),
    )
    .orderBy(desc(sql`ts_rank(${eventVector}, ${tsquery})`), desc(meetingEvents.createdAt))
    .limit(25);

  return NextResponse.json({
    results: [
      ...transcriptMatches.map((r) => ({
        meetingId: r.meetingId,
        meetingTitle: r.meetingTitle,
        type: r.speaker || r.speakerLabel,
        text: r.text,
        createdAt: r.createdAt,
        source: "transcript",
      })),
      ...eventMatches.map((r) => ({
        meetingId: r.meetingId,
        meetingTitle: r.meetingTitle,
        type: r.type,
        text: r.detail ? `${r.text}: ${r.detail}` : r.text,
        createdAt: r.createdAt,
        source: "event",
      })),
    ].slice(0, 50),
  });
}
