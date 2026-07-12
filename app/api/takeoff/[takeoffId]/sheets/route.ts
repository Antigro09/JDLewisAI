import { NextResponse } from "next/server";
import { listSheets } from "@/lib/takeoff-engine/client";
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
    const sheets = await listSheets(row.engineProjectId);
    return NextResponse.json({ sheets });
  } catch (err) {
    return takeoffErrorResponse(err);
  }
}
