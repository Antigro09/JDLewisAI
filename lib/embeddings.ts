/**
 * Text embeddings for semantic meeting memory (spec §12) and RAG (§13).
 *
 * Uses an OpenAI-compatible embeddings endpoint (default text-embedding-3-small,
 * 1536 dims). Configure with EMBEDDINGS_API_KEY (falls back to OPENAI_API_KEY).
 * Returns null when no key is set so callers fall back to Postgres full-text
 * search — the app never hard-depends on a vector provider being present.
 */

export const EMBEDDING_DIMS = 1536;
const MODEL = process.env.EMBEDDINGS_MODEL || "text-embedding-3-small";
const MAX_CHARS = 8000;

export function embeddingsConfigured(): boolean {
  return Boolean(process.env.EMBEDDINGS_API_KEY || process.env.OPENAI_API_KEY);
}

function apiKey() {
  return process.env.EMBEDDINGS_API_KEY || process.env.OPENAI_API_KEY || "";
}

/** Embed a batch of texts. Returns null if embeddings aren't configured. */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const key = apiKey();
  if (!key || texts.length === 0) return null;
  const input = texts.map((t) => t.slice(0, MAX_CHARS));
  const base = process.env.EMBEDDINGS_BASE_URL || "https://api.openai.com/v1";

  const res = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input }),
  });
  if (!res.ok) {
    throw new Error(`Embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: { embedding: number[] }[] };
  const vectors = (json.data ?? []).map((d) => d.embedding);
  return vectors.length === input.length ? vectors : null;
}

/** Embed a single text. Returns null if not configured. */
export async function embedText(text: string): Promise<number[] | null> {
  const out = await embedTexts([text]);
  return out ? out[0] : null;
}

/** Cosine similarity for in-memory comparisons (e.g. voiceprint matching). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
