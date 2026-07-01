import WebSocket from "ws";

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

export type TranscriptionProvider = {
  name: string;
  startSession: (opts: {
    meetingId: string;
    sampleRate: number;
    channels: number;
    onPartial: (event: TranscriptEvent) => void | Promise<void>;
    onFinal: (event: TranscriptEvent) => void | Promise<void>;
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
    let closed = false;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("AssemblyAI WebSocket did not open in time.")),
        15_000,
      );
      socket.once("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    socket.on("message", async (raw) => {
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
        if (data.type === "Termination") closed = true;
      } catch {
        // Ignore malformed provider messages; socket errors are surfaced separately.
      }
    });

    socket.on("close", () => {
      closed = true;
    });

    return {
      id: sessionId,
      sendAudioChunk: async (chunk) => {
        if (closed || socket.readyState !== WebSocket.OPEN) return;
        socket.send(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      },
      endSession: async () => {
        if (closed) return;
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "Terminate" }));
        }
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          socket.once("close", done);
          setTimeout(done, 1500);
        });
        socket.close();
        closed = true;
      },
    };
  }
}

export function getTranscriptionProvider(name = "assemblyai"): TranscriptionProvider {
  if (name === "assemblyai") return new AssemblyAiTranscriptionProvider();
  return new AssemblyAiTranscriptionProvider();
}
