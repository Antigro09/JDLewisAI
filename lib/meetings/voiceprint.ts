/**
 * Voiceprint embedding seam (spec §4 — automatic speaker identification).
 *
 * Cross-meeting speaker ID needs a speaker-embedding model (ECAPA-TDNN /
 * pyannote / NeMo). That's a GPU/Python service, so the app calls it over HTTP
 * rather than running it in-process. Point VOICEPRINT_EMBED_URL at that service;
 * it should accept raw audio and return a fixed-length embedding vector.
 *
 * Until the service is configured, enrollment/matching simply return null and
 * the app uses manual speaker naming (which still persists company-wide).
 */

export function voiceprintConfigured(): boolean {
  return Boolean(process.env.VOICEPRINT_EMBED_URL);
}

/**
 * Send an audio sample (WAV/PCM/webm bytes) to the configured speaker-embedding
 * service and return the voiceprint embedding. Returns null if not configured.
 */
export async function embedVoice(
  audio: Buffer,
  contentType = "audio/wav",
): Promise<number[] | null> {
  const url = process.env.VOICEPRINT_EMBED_URL;
  if (!url) return null;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      ...(process.env.VOICEPRINT_API_KEY
        ? { Authorization: `Bearer ${process.env.VOICEPRINT_API_KEY}` }
        : {}),
    },
    body: new Uint8Array(audio),
  });
  if (!res.ok) {
    throw new Error(`Voiceprint service ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { embedding?: number[]; vector?: number[] };
  const vec = json.embedding ?? json.vector ?? null;
  return Array.isArray(vec) && vec.length > 0 ? vec : null;
}
