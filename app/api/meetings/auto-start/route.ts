import { NextResponse } from "next/server";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { meetingParticipants, meetingSessions } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/server";
import { ensureCompanyForUser } from "@/lib/meetings/access";
import { createNotification } from "@/lib/notifications";
import { recordAudit } from "@/lib/audit";
import { truncate } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A detected meeting reuses an existing active auto-started session if one began
// recently, so the 5s detection loop doesn't spawn duplicates.
const REUSE_WINDOW_MS = 6 * 60 * 60 * 1000;

type Body = { detectedApp?: string; detectionConfidence?: number };

/**
 * Auto-start a meeting on desktop detection. Recording consent is covered by the
 * employee agreement, so this starts immediately (no confirmation prompt) and
 * notifies the user that recording began.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }
  const detectedApp = (body.detectedApp ?? "").trim() || "Detected meeting";
  const confidence = Math.max(0, Math.min(100, Math.round(body.detectionConfidence ?? 0)));
  const company = await ensureCompanyForUser(user);

  // Reuse a recent active auto-started session for this user, if any.
  const cutoff = new Date(Date.now() - REUSE_WINDOW_MS);
  const existing = (
    await db
      .select()
      .from(meetingSessions)
      .where(
        and(
          eq(meetingSessions.ownerId, user.id),
          eq(meetingSessions.source, "desktop"),
          eq(meetingSessions.status, "active"),
          gt(meetingSessions.startedAt, cutoff),
        ),
      )
      .orderBy(desc(meetingSessions.startedAt))
      .limit(1)
  )[0];
  if (existing) {
    return NextResponse.json({ meetingId: existing.id, created: false });
  }

  const title = truncate(
    `${detectedApp} meeting — ${new Date().toLocaleString()}`,
    120,
  );
  const [meeting] = await db
    .insert(meetingSessions)
    .values({
      companyId: company.id,
      ownerId: user.id,
      title,
      source: "desktop",
      status: "active",
      detectedApp,
      detectionConfidence: confidence,
      // Consent is established by the employee agreement.
      consentConfirmed: true,
      autoStartApproved: true,
    })
    .returning();

  await db.insert(meetingParticipants).values({
    meetingId: meeting.id,
    userId: user.id,
    displayName: user.name,
    speakerLabel: "Speaker A",
    role: "Host",
    confidence: 100,
    isHost: true,
  });

  await createNotification({
    userId: user.id,
    kind: "task_complete",
    title: "Meeting recording started",
    body: `Auto-started Meeting Intelligence for a ${detectedApp} call.`,
    link: `/meetings/${meeting.id}`,
  });
  await recordAudit({
    userId: user.id,
    action: "meeting.autostart",
    detail: detectedApp,
  });

  return NextResponse.json({ meetingId: meeting.id, created: true }, { status: 201 });
}
