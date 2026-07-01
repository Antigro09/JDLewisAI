import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  companies,
  memberships,
  meetingActionItems,
  meetingDecisions,
  meetingEvents,
  meetingParticipants,
  meetingRisks,
  meetingSessions,
  projects,
  transcriptSegments,
  type AppUser,
} from "@/lib/db/schema";

export async function ensureCompanyForUser(user: AppUser) {
  const existing = (
    await db
      .select({ company: companies, membership: memberships })
      .from(memberships)
      .innerJoin(companies, eq(memberships.companyId, companies.id))
      .where(eq(memberships.userId, user.id))
      .limit(1)
  )[0];
  if (existing) return existing.company;

  const [company] = await db
    .insert(companies)
    .values({ name: `${user.name || "ContractorAI"} Company` })
    .returning();
  await db.insert(memberships).values({
    companyId: company.id,
    userId: user.id,
    role: user.role === "ADMIN" ? "OWNER" : "MEMBER",
  });
  return company;
}

export async function canAccessCompany(userId: string, companyId: string) {
  const member = (
    await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.companyId, companyId)))
      .limit(1)
  )[0];
  return Boolean(member);
}

export async function getMeetingForUser(user: AppUser, meetingId: string) {
  const meeting = (
    await db
      .select()
      .from(meetingSessions)
      .where(eq(meetingSessions.id, meetingId))
      .limit(1)
  )[0];
  if (!meeting) return null;
  if (meeting.ownerId === user.id) return meeting;

  return (await canAccessCompany(user.id, meeting.companyId)) ? meeting : null;
}

export async function loadMeetingBundle(user: AppUser, meetingId: string) {
  const meeting = await getMeetingForUser(user, meetingId);
  if (!meeting) return null;

  const [
    project,
    participants,
    segments,
    events,
    actionItems,
    decisions,
    risks,
  ] = await Promise.all([
    meeting.projectId
      ? db.select().from(projects).where(eq(projects.id, meeting.projectId)).limit(1)
      : Promise.resolve([]),
    db
      .select()
      .from(meetingParticipants)
      .where(eq(meetingParticipants.meetingId, meeting.id))
      .orderBy(asc(meetingParticipants.speakerLabel)),
    db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meeting.id))
      .orderBy(asc(transcriptSegments.sequence), asc(transcriptSegments.createdAt)),
    db
      .select()
      .from(meetingEvents)
      .where(eq(meetingEvents.meetingId, meeting.id))
      .orderBy(asc(meetingEvents.timestampMs), asc(meetingEvents.createdAt)),
    db
      .select()
      .from(meetingActionItems)
      .where(eq(meetingActionItems.meetingId, meeting.id))
      .orderBy(asc(meetingActionItems.createdAt)),
    db
      .select()
      .from(meetingDecisions)
      .where(eq(meetingDecisions.meetingId, meeting.id))
      .orderBy(asc(meetingDecisions.timestampMs), asc(meetingDecisions.createdAt)),
    db
      .select()
      .from(meetingRisks)
      .where(eq(meetingRisks.meetingId, meeting.id))
      .orderBy(asc(meetingRisks.sourceTimestampMs), asc(meetingRisks.createdAt)),
  ]);

  return {
    meeting,
    project: project[0] ?? null,
    participants,
    segments,
    events,
    actionItems,
    decisions,
    risks,
  };
}

export function transcriptText(
  segments: { speakerName: string | null; speakerLabel: string; text: string; startMs: number }[],
) {
  return segments
    .map((s) => {
      const speaker = s.speakerName || s.speakerLabel || "Unknown Speaker";
      const seconds = Math.max(0, Math.floor((s.startMs ?? 0) / 1000));
      return `[${seconds}s] ${speaker}: ${s.text}`;
    })
    .join("\n");
}
