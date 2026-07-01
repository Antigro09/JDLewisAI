import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { meetingParticipants, meetingSessions, projects } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/server";
import { ensureCompanyForUser } from "@/lib/meetings/access";
import { recordAudit } from "@/lib/audit";
import { truncate } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  title?: string;
  projectId?: string | null;
  source?: "manual" | "desktop" | "browser" | "calendar" | "import";
  detectedApp?: string;
  detectionConfidence?: number;
  consentConfirmed?: boolean;
  autoStartApproved?: boolean;
  rawAudioEnabled?: boolean;
};

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const company = await ensureCompanyForUser(user);
  const rows = await db
    .select()
    .from(meetingSessions)
    .where(eq(meetingSessions.companyId, company.id))
    .orderBy(desc(meetingSessions.startedAt))
    .limit(100);
  return NextResponse.json({ meetings: rows });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = truncate((body.title ?? "Untitled meeting").trim(), 120);
  if (!title) return NextResponse.json({ error: "Title required" }, { status: 400 });
  let projectId = body.projectId || null;
  if (projectId) {
    const project = (
      await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1)
    )[0];
    if (!project) projectId = null;
  }

  const company = await ensureCompanyForUser(user);
  const [meeting] = await db
    .insert(meetingSessions)
    .values({
      companyId: company.id,
      ownerId: user.id,
      projectId,
      title,
      source: body.source ?? "manual",
      detectedApp: body.detectedApp || null,
      detectionConfidence: Math.max(0, Math.min(100, Math.round(body.detectionConfidence ?? 0))),
      consentConfirmed: Boolean(body.consentConfirmed),
      autoStartApproved: Boolean(body.autoStartApproved),
      rawAudioEnabled: Boolean(body.rawAudioEnabled),
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
  await recordAudit({
    userId: user.id,
    action: "meeting.create",
    detail: title,
  });

  return NextResponse.json({ meeting }, { status: 201 });
}
