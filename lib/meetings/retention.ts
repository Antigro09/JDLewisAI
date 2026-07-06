import { and, eq, gt, inArray, isNotNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  companies,
  meetingEmbeddings,
  transcriptSegments,
  meetingSessions,
} from "@/lib/db/schema";
import { log } from "@/lib/log";

export type RetentionPurgeResult = {
  /** Companies with a retention window configured (purge attempted). */
  companies: number;
  segments: number;
  embeddings: number;
};

/**
 * Retention janitor: for every company with a transcript retention window
 * configured (`transcriptRetentionDays` > 0), hard-delete transcript segments
 * and meeting embeddings older than the cutoff. Null retention = keep forever
 * (the default), so this is a no-op until an admin opts in on the Admin page.
 *
 * Runs from the CRON_SECRET-gated /api/cron/meetings route and from the
 * in-process scheduler (lib/meetings/scheduler.ts) after sweepStaleMeetings.
 */
export async function purgeExpiredTranscripts(): Promise<RetentionPurgeResult> {
  const configured = await db
    .select({
      id: companies.id,
      retentionDays: companies.transcriptRetentionDays,
    })
    .from(companies)
    .where(
      and(
        isNotNull(companies.transcriptRetentionDays),
        gt(companies.transcriptRetentionDays, 0),
      ),
    );

  const result: RetentionPurgeResult = { companies: 0, segments: 0, embeddings: 0 };
  for (const company of configured) {
    const retentionDays = company.retentionDays ?? 0;
    if (retentionDays <= 0) continue; // narrowing for strict null checks
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    try {
      // transcript_segments has no company column — scope the delete through
      // the company's meetings with a subquery so it stays one statement.
      const companyMeetings = db
        .select({ id: meetingSessions.id })
        .from(meetingSessions)
        .where(eq(meetingSessions.companyId, company.id));
      const deletedSegments = await db
        .delete(transcriptSegments)
        .where(
          and(
            inArray(transcriptSegments.meetingId, companyMeetings),
            lt(transcriptSegments.createdAt, cutoff),
          ),
        );
      const deletedEmbeddings = await db
        .delete(meetingEmbeddings)
        .where(
          and(
            eq(meetingEmbeddings.companyId, company.id),
            lt(meetingEmbeddings.createdAt, cutoff),
          ),
        );

      const segments = deletedSegments.rowCount ?? 0;
      const embeddings = deletedEmbeddings.rowCount ?? 0;
      result.companies += 1;
      result.segments += segments;
      result.embeddings += embeddings;
      if (segments > 0 || embeddings > 0) {
        log.info("meetings.retention_purged", {
          companyId: company.id,
          retentionDays,
          segments,
          embeddings,
        });
      }
    } catch (err) {
      // One company's failure shouldn't block the rest of the sweep.
      log.error("meetings.retention_purge_failed", err, { companyId: company.id });
    }
  }
  return result;
}
