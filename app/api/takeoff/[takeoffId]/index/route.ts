import { and, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { takeoffProjects, type TakeoffStatus } from "@/lib/db/schema";
import { indexProject } from "@/lib/takeoff-engine/client";
import { requireTakeoff, takeoffErrorResponse } from "@/lib/takeoff-engine/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ takeoffId: string }> },
) {
  const { takeoffId } = await params;
  let priorStatus: TakeoffStatus | undefined;
  try {
    const { row } = await requireTakeoff(takeoffId);
    priorStatus = row.status;
    const now = new Date();
    const [locked] = await db
      .update(takeoffProjects)
      .set({
        status: "indexing",
        jobStatus: "queued",
        jobProgress: "",
        jobError: null,
        processStartedAt: now,
        updatedAt: now,
      })
      .where(and(eq(takeoffProjects.id, row.id), ne(takeoffProjects.status, "processing")))
      .returning();

    if (!locked) {
      return NextResponse.json({ error: "already_processing" }, { status: 409 });
    }

    try {
      const job = await indexProject(row.engineProjectId);
      const [updated] = await db
        .update(takeoffProjects)
        .set({
          engineJobId: job.job_id,
          jobStatus: job.status,
          jobProgress: "",
          jobError: null,
          updatedAt: new Date(),
        })
        .where(eq(takeoffProjects.id, row.id))
        .returning();
      return NextResponse.json({ takeoff: updated, job }, { status: 202 });
    } catch (err) {
      await db
        .update(takeoffProjects)
        .set({ status: priorStatus ?? "created", updatedAt: new Date() })
        .where(eq(takeoffProjects.id, row.id));
      throw err;
    }
  } catch (err) {
    return takeoffErrorResponse(err);
  }
}
