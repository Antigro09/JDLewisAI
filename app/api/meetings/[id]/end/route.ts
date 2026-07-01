import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { meetingSessions } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/server";
import { getMeetingForUser } from "@/lib/meetings/access";
import { analyzeMeeting, generateMeetingMinutes } from "@/lib/meetings/analysis";
import { indexMeetingMemory } from "@/lib/meetings/memory";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const meeting = await getMeetingForUser(user, id);
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  await db
    .update(meetingSessions)
    .set({ status: "processing", endedAt: new Date(), updatedAt: new Date() })
    .where(eq(meetingSessions.id, id));

  try {
    await analyzeMeeting(user, id);
    const minutes = await generateMeetingMinutes(user, id);
    // Index into semantic memory (best-effort — never fail closeout on this).
    try {
      await indexMeetingMemory(id, meeting.companyId);
    } catch {
      // pgvector/embeddings not available; FTS memory still works.
    }
    await recordAudit({
      userId: user.id,
      action: "meeting.end",
      detail: meeting.title,
    });
    return NextResponse.json({ minutes });
  } catch (err) {
    await db
      .update(meetingSessions)
      .set({ status: "ended", updatedAt: new Date() })
      .where(eq(meetingSessions.id, id));
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Meeting closeout failed" },
      { status: 400 },
    );
  }
}
