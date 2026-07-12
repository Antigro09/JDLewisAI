import { and, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { takeoffProjects, type TakeoffStatus } from "@/lib/db/schema";
import { startProcess, startScopedProcess } from "@/lib/takeoff-engine/client";
import { requireTakeoff, takeoffErrorResponse } from "@/lib/takeoff-engine/auth";
import type { TakeoffScope } from "@/lib/takeoff-engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isTakeoffScope(value: unknown): value is TakeoffScope {
  if (!value || typeof value !== "object") return false;
  const scope = value as Partial<TakeoffScope>;
  return typeof scope.instructions === "string" && Array.isArray(scope.requests);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ takeoffId: string }> },
) {
  const { takeoffId } = await params;
  let priorStatus: TakeoffStatus | undefined;
  try {
    const { row } = await requireTakeoff(takeoffId);
    const body = await req.json().catch(() => ({}));
    const submittedScope = isTakeoffScope(body.scope) ? body.scope : null;
    const savedScope = isTakeoffScope(row.takeoffScope) ? row.takeoffScope : null;
    const scope = submittedScope ?? savedScope;
    priorStatus = row.status;
    const now = new Date();
    const [locked] = await db
      .update(takeoffProjects)
      .set({
        status: "processing",
        jobStatus: "queued",
        jobProgress: "",
        jobError: null,
        takeoffInstructions: scope?.instructions ?? row.takeoffInstructions,
        takeoffScope: scope ?? row.takeoffScope,
        processStartedAt: now,
        updatedAt: now,
      })
      .where(and(eq(takeoffProjects.id, row.id), ne(takeoffProjects.status, "processing")))
      .returning();

    if (!locked) {
      return NextResponse.json({ error: "already_processing" }, { status: 409 });
    }

    try {
      const job = scope ? await startScopedProcess(row.engineProjectId, scope) : await startProcess(row.engineProjectId);
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
