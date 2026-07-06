import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectFiles, projectFileEmbeddings } from "@/lib/db/schema";
import { embedTexts, embedText, embeddingsConfigured } from "@/lib/embeddings";
import { log } from "@/lib/log";

/**
 * Semantic Project Knowledge Search (spec §13) backed by pgvector, mirroring
 * lib/meetings/memory.ts. Indexing chunks each text-extractable project file
 * and embeds the chunks into project_file_embeddings; search embeds the query
 * and does a cosine nearest-neighbour lookup. Everything is gated on
 * embeddings being configured and wrapped defensively, so a missing key or
 * extension degrades to the unranked full-text path rather than erroring.
 */

const CHUNK_CHARS = 600;
// Ceiling per file (~240k chars of text) so a 10MB upload can't blow the
// embeddings request or flood the table.
const MAX_CHUNKS_PER_FILE = 400;

/** Same text-extractable filter the search route has always used. */
export function isTextExtractableFile(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    ["application/json", "application/xml", "application/csv"].includes(mime)
  );
}

function splitLongLine(line: string): string[] {
  if (line.length <= CHUNK_CHARS) return [line];
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += CHUNK_CHARS) parts.push(line.slice(i, i + CHUNK_CHARS));
  return parts;
}

/** Pack lines into ~600-char chunks (same shape as meetings/memory.ts). */
function chunkFileText(text: string): string[] {
  const chunks: string[] = [];
  let buf = "";
  for (const line of text.split(/\r?\n/).flatMap(splitLongLine)) {
    if ((buf + "\n" + line).length > CHUNK_CHARS && buf) {
      chunks.push(buf);
      buf = line;
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.map((c) => c.trim()).filter(Boolean);
}

// Dedupe concurrent indexing per project — the app runs as a single
// long-lived Node process on EC2, so an in-process map is sufficient.
const inflight = new Map<string, Promise<void>>();

/**
 * Chunk + embed every text-extractable file in a project, skipping files that
 * are already indexed with unchanged content. No-op when embeddings aren't
 * configured. Never throws — indexing failures are logged and search falls
 * back to the full-text path.
 */
export function ensureProjectFileEmbeddings(projectId: string): Promise<void> {
  if (!embeddingsConfigured()) return Promise.resolve();
  const running = inflight.get(projectId);
  if (running) return running;
  const p = indexProjectFiles(projectId).finally(() => inflight.delete(projectId));
  inflight.set(projectId, p);
  return p;
}

async function indexProjectFiles(projectId: string): Promise<void> {
  // The whole body is wrapped so a missing project_file_embeddings table /
  // pgvector extension (migration 0001 not yet applied) degrades to the search
  // route's full-text fallback instead of rejecting into a 500.
  let files: (typeof projectFiles.$inferSelect)[];
  let indexedIds: Set<string>;
  try {
    files = await db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));
    // Which files already have embeddings. Files are insert/delete-only (a
    // replaced file gets a new id; deletes cascade the rows away), so an id
    // that's already indexed never needs re-embedding — we skip it BEFORE
    // decoding its base64, which keeps repeat searches cheap.
    const existing = await db
      .selectDistinct({ fileId: projectFileEmbeddings.fileId })
      .from(projectFileEmbeddings)
      .where(eq(projectFileEmbeddings.projectId, projectId));
    indexedIds = new Set(existing.map((e) => e.fileId));
  } catch (err) {
    log.error("retrieval.index.read_failed", err, { projectId });
    return;
  }

  const textFiles = files.filter(
    (f) => isTextExtractableFile(f.mime) && !indexedIds.has(f.id),
  );
  if (textFiles.length === 0) return;

  for (const f of textFiles) {
    let content = "";
    try {
      content = Buffer.from(f.data, "base64").toString("utf8");
    } catch {
      continue;
    }
    const chunks = chunkFileText(content).slice(0, MAX_CHUNKS_PER_FILE);
    if (chunks.length === 0) continue;

    let vectors: number[][] | null;
    try {
      vectors = await embedTexts(chunks);
    } catch (err) {
      log.error("retrieval.index.embed_failed", err, { projectId, fileId: f.id });
      continue;
    }
    if (!vectors) return;

    try {
      await db.delete(projectFileEmbeddings).where(eq(projectFileEmbeddings.fileId, f.id));
      await db.insert(projectFileEmbeddings).values(
        chunks.map((c, i) => ({
          projectId,
          fileId: f.id,
          chunkIndex: i,
          content: c,
          embedding: vectors[i],
        })),
      );
    } catch (err) {
      // pgvector extension not installed / column missing → leave a trace and
      // stop; the search route keeps its full-text fallback.
      log.error("retrieval.index.write_failed", err, { projectId, fileId: f.id });
      return;
    }
  }
}

export type ProjectFileHit = {
  fileId: string;
  fileName: string;
  chunkIndex: number;
  content: string;
  score: number;
};

/** Cosine nearest-neighbour search over a project's file chunks. */
export async function semanticSearchProjectFiles(
  projectId: string,
  query: string,
  k = 12,
): Promise<ProjectFileHit[]> {
  if (!embeddingsConfigured()) return [];
  let vec: number[] | null;
  try {
    vec = await embedText(query);
  } catch (err) {
    log.error("retrieval.semantic_search.embed_failed", err, { projectId });
    return [];
  }
  if (!vec) return [];
  const literal = `[${vec.join(",")}]`;

  try {
    const rows = await db
      .select({
        fileId: projectFileEmbeddings.fileId,
        fileName: projectFiles.name,
        chunkIndex: projectFileEmbeddings.chunkIndex,
        content: projectFileEmbeddings.content,
        distance: sql<number>`${projectFileEmbeddings.embedding} <=> ${literal}::vector`,
      })
      .from(projectFileEmbeddings)
      .innerJoin(projectFiles, eq(projectFileEmbeddings.fileId, projectFiles.id))
      .where(eq(projectFileEmbeddings.projectId, projectId))
      .orderBy(sql`${projectFileEmbeddings.embedding} <=> ${literal}::vector`)
      .limit(k);
    return rows.map((r) => ({
      fileId: r.fileId,
      fileName: r.fileName,
      chunkIndex: r.chunkIndex,
      content: r.content,
      score: Math.max(0, 1 - Number(r.distance)),
    }));
  } catch (err) {
    // pgvector extension not installed / column missing → fall back to the
    // unranked full-text path, but leave a trace so a real query failure is
    // distinguishable from "no results".
    log.error("retrieval.semantic_search.query_failed", err, { projectId });
    return [];
  }
}
