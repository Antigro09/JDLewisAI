import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { takeoffProjects, type EngineJobStatus, type TakeoffStatus } from "@/lib/db/schema";
import {
  EngineDownError,
  EngineHttpError,
  EngineTimeoutError,
  getJob,
  getProject,
} from "@/lib/takeoff-engine/client";
import { requireTakeoff, takeoffErrorResponse } from "@/lib/takeoff-engine/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALLED_MS = 20 * 60 * 1000;

function mapJobStatus(status: string, kind = "process"): TakeoffStatus {
  if (kind === "index" && status === "done") return "indexed";
  if (status === "done") return "review";
  if (status === "failed") return "failed";
  return kind === "index" ? "indexing" : "processing";
}

function mapProjectStatus(status: string, fallback: TakeoffStatus): TakeoffStatus {
  if (status === "processed") return "review";
  if (status === "indexed") return "indexed";
  if (status === "indexing") return "indexing";
  if (status === "failed") return "failed";
  if (status === "processing") return "processing";
  if (status === "created") return "created";
  return fallback;
}

function forwardOnly(current: TakeoffStatus, next: TakeoffStatus): TakeoffStatus {
  if ((current === "review" || current === "failed") && next === "processing") return current;
  return next;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ takeoffId: string }> },
) {
  try {
    const { takeoffId } = await params;
    const { row } = await requireTakeoff(takeoffId);

    if (!row.engineJobId) {
      return NextResponse.json({
        status: row.status,
        jobStatus: row.jobStatus,
        progress: row.jobProgress,
        error: row.jobError,
      });
    }

    try {
      const job = await getJob(row.engineJobId);
      const nextStatus = forwardOnly(row.status, mapJobStatus(job.status, job.kind));
      const now = new Date();
      const stalled =
        (job.status === "queued" || job.status === "running") &&
        Boolean(row.processStartedAt) &&
        now.getTime() - row.processStartedAt!.getTime() > STALLED_MS;

      await db
        .update(takeoffProjects)
        .set({
          status: nextStatus,
          jobStatus: job.status as EngineJobStatus,
          jobProgress: job.progress ?? "",
          jobError: job.error || null,
          lastPolledAt: now,
          updatedAt: now,
        })
        .where(eq(takeoffProjects.id, row.id));

      return NextResponse.json({
        status: nextStatus,
        jobStatus: job.status,
        progress: job.progress ?? "",
        error: job.error || null,
        engineDown: false,
        stalled,
      });
    } catch (err) {
      if (err instanceof EngineDownError || err instanceof EngineTimeoutError) {
        return NextResponse.json({
          status: row.status,
          jobStatus: row.jobStatus,
          progress: row.jobProgress,
          error: row.jobError,
          engineDown: true,
          stalled: false,
        });
      }
      if (err instanceof EngineHttpError && err.status === 404) {
        const project = await getProject(row.engineProjectId);
        const nextStatus = forwardOnly(row.status, mapProjectStatus(project.status, row.status));
        await db
          .update(takeoffProjects)
          .set({ status: nextStatus, lastPolledAt: new Date(), updatedAt: new Date() })
          .where(eq(takeoffProjects.id, row.id));
        return NextResponse.json({
          status: nextStatus,
          jobStatus: row.jobStatus,
          progress: row.jobProgress,
          error: row.jobError,
          engineDown: false,
          stalled: nextStatus === "processing",
        });
      }
      throw err;
    }
  } catch (err) {
    return takeoffErrorResponse(err);
  }
}
