import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  meetingParticipants,
  meetingSessions,
  transcriptSegments,
  type MeetingState,
  type MeetingStatus,
} from "@/lib/db/schema";
import {
  getTranscriptionProvider,
  type StreamCloseReason,
  type TranscriptEvent,
  type TranscriptionSession,
} from "@/lib/meetings/transcription";
import { LIVE_STATUSES, transitionMeeting } from "@/lib/meetings/state";
import { runClassifierAgent } from "@/lib/meetings/agents/classifier";
import { transcriptText } from "@/lib/meetings/access";
import { createNotification } from "@/lib/notifications";
import type { AgentContext } from "@/lib/meetings/agents/base";
import { LIVE_MEETING_MODEL } from "@/lib/claude/models";

const TICK_EVERY_FINALS = 6;
const TICK_MIN_INTERVAL_MS = 15_000;
// A wedged classifier call must never disable live ticks forever: the tick is
// raced against this timeout before `ticking` resets.
const TICK_TIMEOUT_MS = 60_000;
// Reconnect backoff after an unexpected transcription-stream loss.
const RECONNECT_DELAYS_MS = [1_000, 5_000, 15_000];

type LiveMeetingSession = {
  meetingId: string;
  provider: string;
  sampleRate: number;
  channels: number;
  transcription: TranscriptionSession;
  lastPartial?: TranscriptEvent;
  startedAt: Date;
  lastAudioAt: number;
  finalsSinceTick: number;
  lastTickAt: number;
  ticking: boolean;
  /** Next transcript sequence number — only touched inside writeChain. */
  nextSeq: number;
  /** Serializes all DB writes for this meeting's finals (ordering + no
   *  sequence collisions + no duplicate participants). */
  writeChain: Promise<void>;
  /** Set by an intentional stop so the onClose reconnect logic stands down. */
  stopping: boolean;
};

/**
 * SINGLE-INSTANCE STATE: live-meeting sessions (provider sockets, write
 * chains, sequence counters, tick timers) live in these in-process Maps.
 * That is correct for the current deployment — one persistent Node process
 * on EC2 — but it assumes exactly ONE app instance: with horizontal scaling,
 * audio chunks or stop requests routed to a different instance would not
 * find the session. Scaling out requires a shared session store (e.g. Redis)
 * plus sticky routing for the audio stream — documented as a future item.
 */
declare global {
  // eslint-disable-next-line no-var
  var __liveMeetingSessions: Map<string, LiveMeetingSession> | undefined;
  // eslint-disable-next-line no-var
  var __liveMeetingStarts: Map<string, Promise<LiveMeetingSession>> | undefined;
}

function sessions() {
  if (!global.__liveMeetingSessions) global.__liveMeetingSessions = new Map();
  return global.__liveMeetingSessions;
}

function pendingStarts() {
  if (!global.__liveMeetingStarts) global.__liveMeetingStarts = new Map();
  return global.__liveMeetingStarts;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
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

/**
 * Persist one final transcript turn. Runs only inside the session's writeChain,
 * so sequence numbers are collision-free and turns commit in order. Never
 * touches `status` — a straggling final must not resurrect a meeting that has
 * moved to processing/complete (the state patch below is guarded to live
 * statuses for the same reason).
 */
async function persistFinal(live: LiveMeetingSession, event: TranscriptEvent) {
  const text = event.text.trim();
  if (!text) return;
  const speakerLabel = event.speakerLabel || "Speaker A";
  await ensureParticipant(live.meetingId, speakerLabel);
  const sequence = live.nextSeq;
  live.nextSeq += 1;
  await db.insert(transcriptSegments).values({
    meetingId: live.meetingId,
    sequence,
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
      updatedAt: new Date(),
      state: {
        currentSpeaker: speakerLabel,
        currentDiscussion: text,
        confidence: Math.max(0, Math.min(100, Math.round(event.confidence ?? 85))),
        updatedAt: new Date().toISOString(),
      },
    })
    .where(
      and(
        eq(meetingSessions.id, live.meetingId),
        inArray(meetingSessions.status, LIVE_STATUSES as unknown as MeetingStatus[]),
      ),
    );
}

function enqueueFinal(live: LiveMeetingSession, event: TranscriptEvent) {
  live.writeChain = live.writeChain
    .then(async () => {
      await persistFinal(live, event);
      maybeRunLiveTick(live.meetingId);
    })
    .catch(() => {
      // A failed persist must not poison the chain for later finals.
    });
  return live.writeChain;
}

/**
 * Incremental live analysis (spec §5/§16). Every few final turns (and no more
 * than once per 15s) run the cheap Classifier agent over recent transcript and
 * patch the live meeting state so the dashboard keeps updating during the
 * meeting. Fully guarded — a failure here never affects transcription.
 */
function maybeRunLiveTick(meetingId: string) {
  const session = sessions().get(meetingId);
  if (!session) return;
  session.finalsSinceTick += 1;
  const now = Date.now();
  if (session.ticking) return;
  if (session.finalsSinceTick < TICK_EVERY_FINALS) return;
  if (now - session.lastTickAt < TICK_MIN_INTERVAL_MS) return;
  session.ticking = true;
  session.finalsSinceTick = 0;
  session.lastTickAt = now;
  // Race against a timeout so a hung model call can't leave `ticking` stuck
  // true forever (which would silently disable live updates for the meeting).
  void Promise.race([runLiveTick(meetingId), sleep(TICK_TIMEOUT_MS)]).finally(() => {
    const s = sessions().get(meetingId);
    if (s) s.ticking = false;
  });
}

async function runLiveTick(meetingId: string) {
  try {
    const meeting = (
      await db.select().from(meetingSessions).where(eq(meetingSessions.id, meetingId)).limit(1)
    )[0];
    if (!meeting) return;

    const segments = await db
      .select({
        speakerName: transcriptSegments.speakerName,
        speakerLabel: transcriptSegments.speakerLabel,
        text: transcriptSegments.text,
        startMs: transcriptSegments.startMs,
      })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meetingId))
      .orderBy(desc(transcriptSegments.sequence))
      .limit(40);
    if (segments.length === 0) return;
    const transcript = transcriptText([...segments].reverse());

    const ctx: AgentContext = {
      userId: meeting.ownerId,
      meetingId,
      companyId: meeting.companyId,
      projectId: meeting.projectId,
      meetingTitle: meeting.title,
      linkedProjectName: null,
      knownProjects: "None",
      transcript,
      liveModel: LIVE_MEETING_MODEL,
    };
    const c = await runClassifierAgent(ctx);

    const prev: MeetingState = meeting.state ?? {};
    const next: MeetingState = {
      ...prev,
      currentTopic: c.currentTopic || prev.currentTopic,
      meetingStage: c.meetingStage || prev.meetingStage,
      categories: c.categories,
      confidence: c.confidence,
      updatedAt: new Date().toISOString(),
    };
    // Guarded like persistFinal: a slow tick that lands after closeout began
    // must not clobber the analysis pipeline's state/summary.
    await db
      .update(meetingSessions)
      .set({ state: next, summary: c.gist || meeting.summary, updatedAt: new Date() })
      .where(
        and(
          eq(meetingSessions.id, meetingId),
          inArray(meetingSessions.status, LIVE_STATUSES as unknown as MeetingStatus[]),
        ),
      );
  } catch {
    // live tick is best-effort
  }
}

function openTranscription(live: LiveMeetingSession): Promise<TranscriptionSession> {
  const provider = getTranscriptionProvider(live.provider);
  return provider.startSession({
    meetingId: live.meetingId,
    sampleRate: live.sampleRate,
    channels: live.channels,
    onPartial: (event) => {
      live.lastPartial = event;
    },
    onFinal: (event) => enqueueFinal(live, event),
    onClose: (reason) => {
      void handleStreamLoss(live, reason);
    },
  });
}

/**
 * Unexpected stream loss: mark the meeting degraded, then try to reconnect
 * with backoff. On success the meeting goes back to active with the same
 * session (sequence counter and write chain intact). On exhaustion the session
 * is dropped from the map (a later /stream/start creates a fresh one) and the
 * owner is notified that recording was interrupted.
 */
async function handleStreamLoss(live: LiveMeetingSession, reason: StreamCloseReason) {
  if (live.stopping) return;
  if (sessions().get(live.meetingId) !== live) return; // superseded

  await transitionMeeting(live.meetingId, ["detected", "active"], "degraded");

  for (const delay of RECONNECT_DELAYS_MS) {
    await sleep(delay);
    if (live.stopping || sessions().get(live.meetingId) !== live) return;
    // The meeting may have been ended/abandoned while we were backing off.
    const row = (
      await db
        .select({ status: meetingSessions.status })
        .from(meetingSessions)
        .where(eq(meetingSessions.id, live.meetingId))
        .limit(1)
    )[0];
    if (!row || !(LIVE_STATUSES as readonly string[]).includes(row.status)) return;

    try {
      live.transcription = await openTranscription(live);
      await transitionMeeting(live.meetingId, ["degraded"], "active");
      return;
    } catch {
      // next backoff step
    }
  }

  // Give up: free the slot so a fresh /stream/start can recover, and tell the
  // owner recording stopped rather than failing silently.
  if (sessions().get(live.meetingId) === live) sessions().delete(live.meetingId);
  try {
    const meeting = (
      await db
        .select({ ownerId: meetingSessions.ownerId, title: meetingSessions.title })
        .from(meetingSessions)
        .where(eq(meetingSessions.id, live.meetingId))
        .limit(1)
    )[0];
    if (meeting) {
      await createNotification({
        userId: meeting.ownerId,
        kind: "error",
        title: "Meeting recording interrupted",
        body: `Live transcription for "${meeting.title}" was lost (${reason}) and could not reconnect. Open the meeting to resume recording.`,
        link: `/meetings/${live.meetingId}`,
      });
    }
  } catch {
    // notification is best-effort
  }
}

export async function startLiveMeetingTranscription(opts: {
  meetingId: string;
  provider?: string;
  sampleRate?: number;
  channels?: number;
}) {
  const existing = sessions().get(opts.meetingId);
  if (existing) return existing;
  // Concurrent starts share one in-flight attempt instead of each opening a
  // provider socket and orphaning all but the last (billed, never closed).
  const pending = pendingStarts().get(opts.meetingId);
  if (pending) return pending;

  const attempt = (async () => {
    const live: LiveMeetingSession = {
      meetingId: opts.meetingId,
      provider: opts.provider ?? "assemblyai",
      sampleRate: opts.sampleRate ?? 16000,
      channels: opts.channels ?? 1,
      transcription: null as unknown as TranscriptionSession,
      startedAt: new Date(),
      lastAudioAt: Date.now(),
      finalsSinceTick: 0,
      lastTickAt: 0,
      ticking: false,
      nextSeq: await nextSequence(opts.meetingId),
      writeChain: Promise.resolve(),
      stopping: false,
    };
    live.transcription = await openTranscription(live);
    sessions().set(opts.meetingId, live);
    // A (re)started stream means the meeting is recording again.
    await transitionMeeting(opts.meetingId, ["detected", "degraded"], "active");
    return live;
  })();

  pendingStarts().set(opts.meetingId, attempt);
  try {
    return await attempt;
  } finally {
    pendingStarts().delete(opts.meetingId);
  }
}

export async function sendLiveMeetingAudio(meetingId: string, audio: Buffer) {
  const session = sessions().get(meetingId);
  if (!session) throw new Error("Live transcription has not been started for this meeting.");
  session.lastAudioAt = Date.now();
  await session.transcription.sendAudioChunk(audio);
}

export async function stopLiveMeetingTranscription(meetingId: string) {
  // If a start is mid-flight, wait for it so we tear down the real socket
  // instead of leaving it to be orphaned a moment later.
  const pending = pendingStarts().get(meetingId);
  if (pending) {
    try {
      await pending;
    } catch {
      // failed start — nothing to stop
    }
  }
  const session = sessions().get(meetingId);
  if (!session) return;
  session.stopping = true;
  sessions().delete(meetingId);
  // Let queued finals land before closing out.
  await session.writeChain;
  await session.transcription.endSession();
}

/** Janitor signal: true if this process holds a live session for the meeting
 *  that has received audio within `windowMs` (silent-but-connected ≠ stale). */
export function hasRecentLiveAudio(meetingId: string, windowMs: number) {
  const session = sessions().get(meetingId);
  if (!session) return false;
  return Date.now() - session.lastAudioAt < windowMs;
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
