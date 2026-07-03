import WebSocket, { type RawData } from "ws";

export type TranscriptEvent = {
  providerId?: string;
  sequence?: number;
  speakerLabel?: string;
  speakerName?: string;
  text: string;
  startMs?: number;
  endMs?: number;
  confidence?: number;
  isFinal: boolean;
};

export type TranscriptionSession = {
  id: string;
  sendAudioChunk: (chunk: ArrayBuffer | Buffer) => Promise<void>;
  endSession: () => Promise<void>;
};

export type StreamCloseReason =
  | "provider_terminated"
  | "socket_closed"
  | "socket_error";

/** Thrown by sendAudioChunk once the provider stream is gone, so callers can
 *  tell "stream needs restarting" apart from other failures. */
export class StreamClosedError extends Error {
  constructor(reason: StreamCloseReason) {
    super(`Transcription stream closed (${reason}).`);
    this.name = "StreamClosedError";
  }
}

export type TranscriptionProvider = {
  name: string;
  startSession: (opts: {
    meetingId: string;
    sampleRate: number;
    channels: number;
    onPartial: (event: TranscriptEvent) => void | Promise<void>;
    onFinal: (event: TranscriptEvent) => void | Promise<void>;
    /** Fired exactly once when the stream dies unexpectedly (never fired for
     *  an intentional endSession) — the hook for reconnect logic. */
    onClose?: (reason: StreamCloseReason) => void;
  }) => Promise<TranscriptionSession>;
};

type AssemblyAiMessage = {
  type?: "Begin" | "Turn" | "Termination" | string;
  id?: string;
  transcript?: string;
  end_of_turn?: boolean;
  confidence?: number;
  speaker?: string;
  words?: { start?: number; end?: number; confidence?: number; speaker?: string }[];
};

function confidenceToInt(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 85;
  return Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)));
}

function normalizeSpeaker(speaker: unknown) {
  const s = typeof speaker === "string" ? speaker.trim() : "";
  if (!s) return "Speaker A";
  return s.toLowerCase().startsWith("speaker") ? s : `Speaker ${s}`;
}

function eventFromTurn(data: AssemblyAiMessage, isFinal: boolean): TranscriptEvent | null {
  const transcript = (data.transcript ?? "").trim();
  if (!transcript) return null;
  const firstWord = data.words?.[0];
  const lastWord = data.words?.[data.words.length - 1];
  const speaker = data.speaker ?? firstWord?.speaker;
  const wordConfidence =
    data.words?.length
      ? data.words.reduce((sum, w) => sum + (w.confidence ?? 0), 0) / data.words.length
      : undefined;
  return {
    speakerLabel: normalizeSpeaker(speaker),
    text: transcript,
    startMs: Math.round(firstWord?.start ?? 0),
    endMs: Math.round(lastWord?.end ?? firstWord?.start ?? 0),
    confidence: confidenceToInt(data.confidence ?? wordConfidence),
    isFinal,
  };
}

export class AssemblyAiTranscriptionProvider implements TranscriptionProvider {
  name = "assemblyai";

  async startSession(opts: {
    meetingId: string;
    sampleRate: number;
    channels: number;
    onPartial: (event: TranscriptEvent) => void | Promise<void>;
    onFinal: (event: TranscriptEvent) => void | Promise<void>;
    onClose?: (reason: StreamCloseReason) => void;
  }): Promise<TranscriptionSession> {
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
      throw new Error("ASSEMBLYAI_API_KEY is required for live meeting transcription.");
    }
    if (opts.channels !== 1) {
      throw new Error("AssemblyAI live transcription expects mono PCM chunks.");
    }

    const params = new URLSearchParams({
      speech_model: process.env.ASSEMBLYAI_SPEECH_MODEL || "u3-rt-pro",
      encoding: "pcm_s16le",
      sample_rate: String(opts.sampleRate),
      format_turns: "true",
      speaker_labels: "true",
      end_of_turn_confidence_threshold:
        process.env.ASSEMBLYAI_END_OF_TURN_THRESHOLD || "0.4",
      token: apiKey,
    });
    const socket = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${params.toString()}`);

    let sessionId = opts.meetingId;
    let closedReason: StreamCloseReason | null = null;
    let intentionalEnd = false;
    let onCloseFired = false;

    // Fire the consumer's onClose exactly once, and never for a close the
    // consumer itself requested via endSession.
    const notifyClosed = (reason: StreamCloseReason) => {
      if (closedReason === null) closedReason = reason;
      if (intentionalEnd || onCloseFired) return;
      onCloseFired = true;
      try {
        opts.onClose?.(reason);
      } catch {
        // consumer callback must never break the socket teardown
      }
    };

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("AssemblyAI WebSocket did not open in time.")),
        15_000,
      );
      socket.once("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once("error", (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Persistent error handler for the socket's whole life. Without one, a
    // second post-open "error" event is an unhandled EventEmitter error that
    // crashes the entire Node process (the once() above is consumed by the
    // open handshake).
    socket.on("error", () => {
      notifyClosed("socket_error");
    });

    socket.on("message", async (raw: RawData) => {
      try {
        const data = JSON.parse(raw.toString()) as AssemblyAiMessage;
        if (data.type === "Begin" && data.id) {
          sessionId = data.id;
          return;
        }
        if (data.type === "Turn") {
          const ev = eventFromTurn(data, Boolean(data.end_of_turn));
          if (!ev) return;
          ev.providerId = sessionId;
          if (ev.isFinal) await opts.onFinal(ev);
          else await opts.onPartial(ev);
          return;
        }
        if (data.type === "Termination") notifyClosed("provider_terminated");
      } catch {
        // Ignore malformed provider messages; socket errors are surfaced separately.
      }
    });

    socket.on("close", () => {
      notifyClosed("socket_closed");
    });

    return {
      id: sessionId,
      sendAudioChunk: async (chunk) => {
        // Surface a dead stream instead of silently dropping audio — the
        // caller decides whether to reconnect or mark the meeting degraded.
        if (closedReason) throw new StreamClosedError(closedReason);
        if (socket.readyState !== WebSocket.OPEN) {
          throw new StreamClosedError("socket_closed");
        }
        socket.send(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      },
      endSession: async () => {
        intentionalEnd = true;
        if (closedReason) return;
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "Terminate" }));
        }
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          socket.once("close", done);
          setTimeout(done, 1500);
        });
        socket.close();
        if (closedReason === null) closedReason = "socket_closed";
      },
    };
  }
}

export function getTranscriptionProvider(name = "assemblyai"): TranscriptionProvider {
  if (name === "assemblyai") return new AssemblyAiTranscriptionProvider();
  return new AssemblyAiTranscriptionProvider();
}
