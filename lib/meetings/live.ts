import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  meetingParticipants,
  meetingSessions,
  transcriptSegments,
} from "@/lib/db/schema";
import {
  getTranscriptionProvider,
  type TranscriptEvent,
  type TranscriptionSession,
} from "@/lib/meetings/transcription";

type LiveMeetingSession = {
  meetingId: string;
  provider: string;
  sampleRate: number;
  channels: number;
  transcription: TranscriptionSession;
  lastPartial?: TranscriptEvent;
  startedAt: Date;
};

declare global {
  // eslint-disable-next-line no-var
  var __liveMeetingSessions: Map<string, LiveMeetingSession> | undefined;
}

function sessions() {
  if (!global.__liveMeetingSessions) global.__liveMeetingSessions = new Map();
  return global.__liveMeetingSessions;
}

async function nextSequence(meetingId: string) {
  const last = (
    await db
      .select({ sequence: transcriptSegments.sequence })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meetingId))
      .orderBy(desc(transcriptSegments.sequence))
      .limit(1)
  )[0];
  return (last?.sequence ?? 0) + 1;
}

async function ensureParticipant(meetingId: string, speakerLabel: string) {
  const existing = (
    await db
      .select({ id: meetingParticipants.id })
      .from(meetingParticipants)
      .where(
        and(
          eq(meetingParticipants.meetingId, meetingId),
          eq(meetingParticipants.speakerLabel, speakerLabel),
        ),
      )
      .limit(1)
  )[0];
  if (existing) return;
  await db.insert(meetingParticipants).values({
    meetingId,
    displayName: speakerLabel,
    speakerLabel,
    confidence: 0,
  });
}

async function persistFinal(meetingId: string, event: TranscriptEvent) {
  const text = event.text.trim();
  if (!text) return;
  const speakerLabel = event.speakerLabel || "Speaker A";
  await ensureParticipant(meetingId, speakerLabel);
  await db.insert(transcriptSegments).values({
    meetingId,
    sequence: await nextSequence(meetingId),
    speakerLabel,
    speakerName: event.speakerName || null,
    text,
    startMs: Math.max(0, Math.round(event.startMs ?? 0)),
    endMs: Math.max(0, Math.round(event.endMs ?? event.startMs ?? 0)),
    confidence: Math.max(0, Math.min(100, Math.round(event.confidence ?? 85))),
    isFinal: true,
  });
  await db
    .update(meetingSessions)
    .set({
      status: "active",
      updatedAt: new Date(),
      state: {
        currentSpeaker: speakerLabel,
        currentDiscussion: text,
        confidence: Math.max(0, Math.min(100, Math.round(event.confidence ?? 85))),
        updatedAt: new Date().toISOString(),
      },
    })
    .where(eq(meetingSessions.id, meetingId));
}

export async function startLiveMeetingTranscription(opts: {
  meetingId: string;
  provider?: string;
  sampleRate?: number;
  channels?: number;
}) {
  const map = sessions();
  const existing = map.get(opts.meetingId);
  if (existing) return existing;

  const providerName = opts.provider ?? "assemblyai";
  const sampleRate = opts.sampleRate ?? 16000;
  const channels = opts.channels ?? 1;
  const provider = getTranscriptionProvider(providerName);
  const live: Partial<LiveMeetingSession> = {
    meetingId: opts.meetingId,
    provider: providerName,
    sampleRate,
    channels,
    startedAt: new Date(),
  };
  const transcription = await provider.startSession({
    meetingId: opts.meetingId,
    sampleRate,
    channels,
    onPartial: (event) => {
      live.lastPartial = event;
    },
    onFinal: (event) => persistFinal(opts.meetingId, event),
  });
  const session: LiveMeetingSession = {
    ...(live as Omit<LiveMeetingSession, "transcription">),
    transcription,
  };
  map.set(opts.meetingId, session);
  return session;
}

export async function sendLiveMeetingAudio(meetingId: string, audio: Buffer) {
  const session = sessions().get(meetingId);
  if (!session) throw new Error("Live transcription has not been started for this meeting.");
  await session.transcription.sendAudioChunk(audio);
}

export async function stopLiveMeetingTranscription(meetingId: string) {
  const session = sessions().get(meetingId);
  if (!session) return;
  await session.transcription.endSession();
  sessions().delete(meetingId);
}

export function liveMeetingStatus(meetingId: string) {
  const session = sessions().get(meetingId);
  if (!session) return null;
  return {
    meetingId,
    provider: session.provider,
    sampleRate: session.sampleRate,
    channels: session.channels,
    startedAt: session.startedAt.toISOString(),
    lastPartial: session.lastPartial,
  };
}
