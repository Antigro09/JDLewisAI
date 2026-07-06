import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  meetingEmbeddings,
  meetingActionItems,
  meetingDecisions,
  meetingRisks,
  transcriptSegments,
} from "@/lib/db/schema";
import { embedTexts, embedText, embeddingsConfigured } from "@/lib/embeddings";
import { log } from "@/lib/log";

/**
 * Semantic meeting memory (spec §12) backed by pgvector. Indexing embeds the
 * transcript (chunked) plus extracted items; search embeds the query and does a
 * cosine nearest-neighbour lookup. Everything is gated on embeddings being
 * configured and wrapped defensively, so a missing key or extension degrades to
 * the Postgres full-text path rather than erroring.
 */

const CHUNK_CHARS = 600;

function chunkTranscript(
  segments: { speakerName: string | null; speakerLabel: string; text: string }[],
): string[] {
  const chunks: string[] = [];
  let buf = "";
  for (const s of segments) {
    const line = `${s.speakerName || s.speakerLabel}: ${s.text}`;
    if ((buf + "\n" + line).length > CHUNK_CHARS && buf) {
      chunks.push(buf);
      buf = line;
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/** Embed and store a meeting's transcript + extracted items. No-op if unconfigured. */
export async function indexMeetingMemory(meetingId: string, companyId: string): Promise<void> {
  if (!embeddingsConfigured()) return;

  const [segments, actions, decisions, risks] = await Promise.all([
    db
      .select({
        speakerName: transcriptSegments.speakerName,
        speakerLabel: transcriptSegments.speakerLabel,
        text: transcriptSegments.text,
      })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meetingId)),
    db.select().from(meetingActionItems).where(eq(meetingActionItems.meetingId, meetingId)),
    db.select().from(meetingDecisions).where(eq(meetingDecisions.meetingId, meetingId)),
    db.select().from(meetingRisks).where(eq(meetingRisks.meetingId, meetingId)),
  ]);

  const items: { sourceType: string; sourceId: string; content: string }[] = [];
  chunkTranscript(segments).forEach((c, i) =>
    items.push({ sourceType: "transcript", sourceId: `${meetingId}:${i}`, content: c }),
  );
  actions.forEach((a) =>
    items.push({
      sourceType: "action_item",
      sourceId: a.id,
      content: `Action: ${a.task}${a.ownerName ? ` (owner ${a.ownerName})` : ""}`,
    }),
  );
  decisions.forEach((d) =>
    items.push({ sourceType: "decision", sourceId: d.id, content: `Decision: ${d.decision}` }),
  );
  risks.forEach((r) =>
    items.push({
      sourceType: "risk",
      sourceId: r.id,
      content: `Risk (${r.riskType}): ${r.description}`,
    }),
  );
  if (items.length === 0) return;

  const vectors = await embedTexts(items.map((i) => i.content));
  if (!vectors) return;

  await db.delete(meetingEmbeddings).where(eq(meetingEmbeddings.meetingId, meetingId));
  await db.insert(meetingEmbeddings).values(
    items.map((it, i) => ({
      companyId,
      meetingId,
      sourceType: it.sourceType,
      sourceId: it.sourceId,
      content: it.content,
      embedding: vectors[i],
    })),
  );
}

export type SemanticHit = {
  meetingId: string;
  sourceType: string;
  content: string;
  score: number;
};

/** Cosine nearest-neighbour search across a company's meeting memory. */
export async function semanticSearchMeetings(
  companyId: string,
  query: string,
  limit = 20,
): Promise<SemanticHit[]> {
  if (!embeddingsConfigured()) return [];
  let vec: number[] | null;
  try {
    vec = await embedText(query);
  } catch (err) {
    log.error("meetings.semantic_search.embed_failed", err, { companyId });
    return [];
  }
  if (!vec) return [];
  const literal = `[${vec.join(",")}]`;

  try {
    const rows = await db
      .select({
        meetingId: meetingEmbeddings.meetingId,
        sourceType: meetingEmbeddings.sourceType,
        content: meetingEmbeddings.content,
        distance: sql<number>`${meetingEmbeddings.embedding} <=> ${literal}::vector`,
      })
      .from(meetingEmbeddings)
      .where(eq(meetingEmbeddings.companyId, companyId))
      .orderBy(sql`${meetingEmbeddings.embedding} <=> ${literal}::vector`)
      .limit(limit);
    return rows.map((r) => ({
      meetingId: r.meetingId,
      sourceType: r.sourceType,
      content: r.content,
      score: Math.max(0, 1 - Number(r.distance)),
    }));
  } catch (err) {
    // pgvector extension not installed / column missing → fall back to FTS,
    // but leave a trace so a real query failure is distinguishable from
    // "no results".
    log.error("meetings.semantic_search.query_failed", err, { companyId });
    return [];
  }
}
