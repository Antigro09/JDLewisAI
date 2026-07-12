import { NextResponse } from "next/server";
import { listCorrections } from "@/lib/takeoff-engine/client";
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
    const corrections = await listCorrections(row.engineProjectId);
    return NextResponse.json({ corrections });
  } catch (err) {
    return takeoffErrorResponse(err);
  }
}
