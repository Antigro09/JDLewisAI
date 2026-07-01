/**
 * Server-side text-to-speech. Uses a real provider (ElevenLabs or OpenAI) for
 * natural, human-sounding voices; returns null when no provider is configured
 * so the client can fall back to the browser's built-in speech synthesis.
 *
 * Configure via env (add one of these when you have a key):
 *   ELEVENLABS_API_KEY   + optional ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL
 *   OPENAI_API_KEY       + optional TTS_VOICE, TTS_MODEL
 * ElevenLabs is preferred when both are set (it sounds the most human).
 */

const MAX_CHARS = 4000;

export type TtsResult = { audio: Buffer; contentType: string };

export function ttsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY || process.env.OPENAI_API_KEY);
}

export async function synthesizeSpeech(text: string): Promise<TtsResult | null> {
  const input = text.slice(0, MAX_CHARS).trim();
  if (!input) return null;

  if (process.env.ELEVENLABS_API_KEY) {
    return elevenLabs(input);
  }
  if (process.env.OPENAI_API_KEY) {
    return openai(input);
  }
  return null;
}

async function elevenLabs(text: string): Promise<TtsResult> {
  // Default voice "Rachel" — a warm, natural narrator voice.
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const model = process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5";
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY!,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.3 },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const audio = Buffer.from(await res.arrayBuffer());
  return { audio, contentType: "audio/mpeg" };
}

async function openai(text: string): Promise<TtsResult> {
  const voice = process.env.TTS_VOICE || "nova";
  const model = process.env.TTS_MODEL || "gpt-4o-mini-tts";
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      response_format: "mp3",
      // Only honored by gpt-4o-mini-tts; ignored by tts-1/tts-1-hd.
      instructions:
        "Speak in a warm, natural, conversational tone — like a helpful colleague, not a robot.",
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const audio = Buffer.from(await res.arrayBuffer());
  return { audio, contentType: "audio/mpeg" };
}
