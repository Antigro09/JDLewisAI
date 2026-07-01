import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  meetingParticipants,
  meetingSessions,
  transcriptSegments,
} from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/server";
import { getMeetingForUser } from "@/lib/meetings/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  speakerLabel?: string;
  speakerName?: string;
  text?: string;
  startMs?: number;
  endMs?: number;
  confidence?: number;
  isFinal?: boolean;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const meeting = await getMeetingForUser(user, id);
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const content = (body.text ?? "").trim();
  if (!content) return NextResponse.json({ error: "Transcript text required" }, { status: 400 });
  const speakerLabel = (body.speakerLabel ?? "Speaker A").trim() || "Speaker A";
  const speakerName = (body.speakerName ?? "").trim() || null;
  const last = (
    await db
      .select({ sequence: transcriptSegments.sequence })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, id))
      .orderBy(desc(transcriptSegments.sequence))
      .limit(1)
  )[0];

  const [segment] = await db
    .insert(transcriptSegments)
    .values({
      meetingId: id,
      sequence: (last?.sequence ?? 0) + 1,
      speakerLabel,
      speakerName,
      text: content,
      startMs: Math.max(0, Math.round(body.startMs ?? 0)),
      endMs: Math.max(0, Math.round(body.endMs ?? body.startMs ?? 0)),
      confidence: Math.max(0, Math.min(100, Math.round(body.confidence ?? 85))),
      isFinal: body.isFinal !== false,
    })
    .returning();

  const existingParticipant = (
    await db
      .select({ id: meetingParticipants.id })
      .from(meetingParticipants)
      .where(
        and(
          eq(meetingParticipants.meetingId, id),
          eq(meetingParticipants.speakerLabel, speakerLabel),
        ),
      )
      .limit(1)
  )[0];
  if (!existingParticipant) {
    await db.insert(meetingParticipants).values({
      meetingId: id,
      displayName: speakerName ?? speakerLabel,
      speakerLabel,
      confidence: speakerName ? 90 : 0,
    });
  }

  await db
    .update(meetingSessions)
    .set({ updatedAt: new Date() })
    .where(eq(meetingSessions.id, meeting.id));

  return NextResponse.json({ segment }, { status: 201 });
}
