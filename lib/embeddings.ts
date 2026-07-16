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

/** Per-request timeout and bounded retry for the embeddings HTTP call. A
 * transient 429/5xx during e.g. meeting closeout must not permanently exclude
 * that content from semantic memory, so we retry with exponential backoff
 * (honoring Retry-After) instead of throwing on the first blip. */
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Embed a batch of texts. Returns null if embeddings aren't configured.
 * Throws only after exhausting retries on a persistent provider error. */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const key = apiKey();
  if (!key || texts.length === 0) return null;
  const input = texts.map((t) => t.slice(0, MAX_CHARS));
  const base = process.env.EMBEDDINGS_BASE_URL || "https://api.openai.com/v1";

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/embeddings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, input }),
        signal: controller.signal,
      });
      if (!res.ok) {
        // Retry transient failures (429 rate limit, 5xx); fail fast on 4xx
        // (bad key/model/input) where retrying can't help.
        const retriable = res.status === 429 || res.status >= 500;
        const body = (await res.text()).slice(0, 200);
        if (retriable && attempt < MAX_ATTEMPTS) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const backoff = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 2 ** (attempt - 1) * 500;
          await sleep(backoff);
          continue;
        }
        throw new Error(`Embeddings ${res.status}: ${body}`);
      }
      const json = (await res.json()) as { data?: { embedding: number[]; index?: number }[] };
      const data = json.data ?? [];
      if (data.length !== input.length) return null;
      // Order by the provider's `index` when present (OpenAI returns in-order,
      // but a compatible proxy may not) so vectors never desync from inputs.
      const ordered = data.every((d) => typeof d.index === "number")
        ? [...data].sort((a, b) => (a.index! - b.index!))
        : data;
      const vectors = ordered.map((d) => d.embedding);
      // Guard against a silently wrong-dimension model/provider — mixing vector
      // spaces produces meaningless cosine distances, not an error.
      if (vectors.some((v) => !Array.isArray(v) || v.length !== EMBEDDING_DIMS)) {
        throw new Error(
          `Embeddings returned ${vectors[0]?.length ?? 0}-dim vectors, expected ${EMBEDDING_DIMS} (check EMBEDDINGS_MODEL).`,
        );
      }
      return vectors;
    } catch (err) {
      lastErr = err;
      const aborted = err instanceof Error && err.name === "AbortError";
      if (attempt < MAX_ATTEMPTS && aborted) {
        await sleep(2 ** (attempt - 1) * 500);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Embeddings failed");
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
