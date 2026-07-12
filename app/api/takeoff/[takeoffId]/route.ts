import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { takeoffProjects } from "@/lib/db/schema";
import { EngineDownError, EngineTimeoutError, getProject } from "@/lib/takeoff-engine/client";
import { requireTakeoff, takeoffErrorResponse } from "@/lib/takeoff-engine/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ takeoffId: string }> },
) {
  try {
    const { takeoffId } = await params;
    const { row } = await requireTakeoff(takeoffId);
    try {
      const engineProject = await getProject(row.engineProjectId);
      return NextResponse.json({ takeoff: row, engineProject });
    } catch (err) {
      if (err instanceof EngineDownError || err instanceof EngineTimeoutError) {
        return NextResponse.json({ takeoff: row, engineDown: true });
      }
      throw err;
    }
  } catch (err) {
    return takeoffErrorResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ takeoffId: string }> },
) {
  try {
    const { takeoffId } = await params;
    await requireTakeoff(takeoffId);
    await db.delete(takeoffProjects).where(eq(takeoffProjects.id, takeoffId));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return takeoffErrorResponse(err);
  }
}
