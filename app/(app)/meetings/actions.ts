"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { meetingParticipants, meetingSessions } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";
import { ensureCompanyForUser } from "@/lib/meetings/access";
import { truncate } from "@/lib/utils";
import { recordAudit } from "@/lib/audit";

export async function createMeetingAction(formData: FormData) {
  const user = await requireUser();
  const title = truncate(String(formData.get("title") ?? "").trim(), 120);
  if (!title) return;
  const projectId = String(formData.get("projectId") ?? "") || null;
  const rawAudioEnabled = formData.get("rawAudioEnabled") === "on";
  const company = await ensureCompanyForUser(user);
  // A company consent policy overrides the form's blanket employee-agreement
  // value — the live workspace collects the acknowledgement before capture.
  const consentConfirmed = company.recordingConsentRequired
    ? false
    : formData.get("consentConfirmed") === "on";

  const [meeting] = await db
    .insert(meetingSessions)
    .values({
      companyId: company.id,
      ownerId: user.id,
      projectId,
      title,
      source: "manual",
      consentConfirmed,
      rawAudioEnabled,
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
  redirect(`/meetings/${meeting.id}`);
}
