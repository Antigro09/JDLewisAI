import { NextResponse } from "next/server";
import { getOverlay } from "@/lib/takeoff-engine/client";
import {
  assertSheetInProject,
  requireTakeoff,
  takeoffErrorResponse,
} from "@/lib/takeoff-engine/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ takeoffId: string; sheetId: string }> },
) {
  try {
    const { takeoffId, sheetId } = await params;
    const { row } = await requireTakeoff(takeoffId);
    await assertSheetInProject(row.engineProjectId, sheetId);
    const overlay = await getOverlay(sheetId);
    return NextResponse.json({ overlay });
  } catch (err) {
    return takeoffErrorResponse(err);
  }
}
