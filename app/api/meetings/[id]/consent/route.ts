import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { meetingSessions } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/server";
import { getMeetingForUser } from "@/lib/meetings/access";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Record the user's acknowledgement of the company's recording-consent notice
 * for this meeting. Idempotent. The stream/start route refuses to open a
 * transcription session until this flag is set when the company policy
 * (companies.recordingConsentRequired) demands it.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const meeting = await getMeetingForUser(user, id);
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  if (!meeting.consentConfirmed) {
    await db
      .update(meetingSessions)
      .set({ consentConfirmed: true, updatedAt: new Date() })
      .where(eq(meetingSessions.id, meeting.id));
    await recordAudit({
      userId: user.id,
      action: "meeting.consent",
      detail: meeting.title,
    });
  }
  return NextResponse.json({ consentConfirmed: true });
}
