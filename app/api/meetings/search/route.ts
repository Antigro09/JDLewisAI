import { NextResponse } from "next/server";
import { and, desc, eq, ilike, or } from "drizzle-orm";
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

  const transcriptMatches = await db
    .select({
      meetingId: meetingSessions.id,
      meetingTitle: meetingSessions.title,
      type: transcriptSegments.speakerLabel,
      text: transcriptSegments.text,
      createdAt: transcriptSegments.createdAt,
    })
    .from(transcriptSegments)
    .innerJoin(meetingSessions, eq(transcriptSegments.meetingId, meetingSessions.id))
    .where(and(eq(meetingSessions.companyId, company.id), ilike(transcriptSegments.text, pattern)))
    .orderBy(desc(transcriptSegments.createdAt))
    .limit(25);

  const eventMatches = await db
    .select({
      meetingId: meetingSessions.id,
      meetingTitle: meetingSessions.title,
      type: meetingEvents.type,
      text: meetingEvents.title,
      detail: meetingEvents.detail,
      createdAt: meetingEvents.createdAt,
    })
    .from(meetingEvents)
    .innerJoin(meetingSessions, eq(meetingEvents.meetingId, meetingSessions.id))
    .where(
      and(
        eq(meetingSessions.companyId, company.id),
        or(ilike(meetingEvents.title, pattern), ilike(meetingEvents.detail, pattern)),
      ),
    )
    .orderBy(desc(meetingEvents.createdAt))
    .limit(25);

  return NextResponse.json({
    results: [
      ...transcriptMatches.map((r) => ({ ...r, source: "transcript" })),
      ...eventMatches.map((r) => ({ ...r, source: "event", text: r.detail ? `${r.text}: ${r.detail}` : r.text })),
    ].slice(0, 50),
  });
}
