import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  meetingParticipants,
  speakerProfiles,
  transcriptSegments,
  type AppUser,
  type SpeakerProfile,
} from "@/lib/db/schema";
import { getMeetingForUser } from "@/lib/meetings/access";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { cosineSimilarity } from "@/lib/embeddings";

/**
 * Speaker identification (spec §4). Live diarization gives A/B/C labels; this
 * layer maps those labels to real people and remembers them company-wide.
 *
 * Two identification paths:
 *  - Manual (always available): a user assigns a label to a person; the name is
 *    written back onto the transcript and the person is stored as a reusable
 *    company "speaker profile".
 *  - Voiceprint (when a voice-embedding service is configured): an enrolled
 *    profile stores an encrypted embedding; future speakers are matched by
 *    cosine similarity so they're recognized automatically. See voiceprint.ts.
 */

const MATCH_THRESHOLD = 0.72; // auto-accept above this cosine similarity
const ASK_THRESHOLD = 0.55; // between ask/accept → surface to the user once

export async function listSpeakerProfiles(companyId: string): Promise<SpeakerProfile[]> {
  return db
    .select()
    .from(speakerProfiles)
    .where(eq(speakerProfiles.companyId, companyId))
    .orderBy(asc(speakerProfiles.displayName));
}

/** Register a person as a company speaker (optionally with a voiceprint). */
export async function enrollSpeaker(opts: {
  companyId: string;
  displayName: string;
  userId?: string | null;
  embedding?: number[] | null;
}): Promise<SpeakerProfile> {
  const [row] = await db
    .insert(speakerProfiles)
    .values({
      companyId: opts.companyId,
      userId: opts.userId ?? null,
      displayName: opts.displayName.trim(),
      embeddingEnc: opts.embedding?.length
        ? encryptSecret(JSON.stringify(opts.embedding))
        : null,
      enrollmentStatus: opts.embedding?.length ? "enrolled" : "not_started",
    })
    .returning();
  return row;
}

function profileEmbedding(p: SpeakerProfile): number[] | null {
  if (!p.embeddingEnc) return null;
  try {
    const parsed = JSON.parse(decryptSecret(p.embeddingEnc));
    return Array.isArray(parsed) ? (parsed as number[]) : null;
  } catch {
    return null;
  }
}

/**
 * Match a voiceprint embedding against enrolled company profiles.
 * Returns the best profile plus a decision: accept / ask / unknown.
 */
export async function matchVoiceprint(
  companyId: string,
  embedding: number[],
): Promise<{ profile: SpeakerProfile | null; score: number; decision: "accept" | "ask" | "unknown" }> {
  const profiles = await listSpeakerProfiles(companyId);
  let best: SpeakerProfile | null = null;
  let bestScore = 0;
  for (const p of profiles) {
    const emb = profileEmbedding(p);
    if (!emb) continue;
    const score = cosineSimilarity(embedding, emb);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  const decision =
    bestScore >= MATCH_THRESHOLD ? "accept" : bestScore >= ASK_THRESHOLD ? "ask" : "unknown";
  return { profile: decision === "unknown" ? null : best, score: bestScore, decision };
}

/**
 * Assign a diarization label ("Speaker A") in a meeting to a real person, write
 * the name onto every matching transcript segment, and remember the person as a
 * company profile for reuse.
 */
export async function assignSpeakerLabel(opts: {
  user: AppUser;
  meetingId: string;
  speakerLabel: string;
  displayName?: string;
  profileId?: string;
}): Promise<{ displayName: string; profileId: string | null }> {
  const meeting = await getMeetingForUser(opts.user, opts.meetingId);
  if (!meeting) throw new Error("Meeting not found");

  let profile: SpeakerProfile | null = null;
  if (opts.profileId) {
    profile =
      (
        await db
          .select()
          .from(speakerProfiles)
          .where(
            and(
              eq(speakerProfiles.id, opts.profileId),
              eq(speakerProfiles.companyId, meeting.companyId),
            ),
          )
          .limit(1)
      )[0] ?? null;
  }
  const name = (profile?.displayName ?? opts.displayName ?? "").trim();
  if (!name) throw new Error("A name or profile is required.");
  if (!profile) {
    profile = await enrollSpeaker({ companyId: meeting.companyId, displayName: name });
  }

  // Upsert the per-meeting participant mapping.
  const existing = (
    await db
      .select({ id: meetingParticipants.id })
      .from(meetingParticipants)
      .where(
        and(
          eq(meetingParticipants.meetingId, opts.meetingId),
          eq(meetingParticipants.speakerLabel, opts.speakerLabel),
        ),
      )
      .limit(1)
  )[0];
  if (existing) {
    await db
      .update(meetingParticipants)
      .set({ displayName: name, userId: profile.userId ?? null, confidence: 100 })
      .where(eq(meetingParticipants.id, existing.id));
  } else {
    await db.insert(meetingParticipants).values({
      meetingId: opts.meetingId,
      userId: profile.userId ?? null,
      displayName: name,
      speakerLabel: opts.speakerLabel,
      confidence: 100,
    });
  }

  // Write the resolved name onto the transcript for this label.
  await db
    .update(transcriptSegments)
    .set({ speakerName: name })
    .where(
      and(
        eq(transcriptSegments.meetingId, opts.meetingId),
        eq(transcriptSegments.speakerLabel, opts.speakerLabel),
      ),
    );

  return { displayName: name, profileId: profile.id };
}
