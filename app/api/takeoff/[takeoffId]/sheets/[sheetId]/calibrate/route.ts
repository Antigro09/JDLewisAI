import { NextRequest, NextResponse } from "next/server";
import { calibrate } from "@/lib/takeoff-engine/client";
import {
  assertSheetInProject,
  requireTakeoff,
  takeoffErrorResponse,
} from "@/lib/takeoff-engine/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function point(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ takeoffId: string; sheetId: string }> },
) {
  try {
    const { takeoffId, sheetId } = await params;
    const { row } = await requireTakeoff(takeoffId);
    await assertSheetInProject(row.engineProjectId, sheetId);
    const body = await req.json().catch(() => ({}));
    const p1 = point(body.p1);
    const p2 = point(body.p2);
    const realDistance = Number(body.real_distance_ft);
    if (!p1 || !p2 || !(realDistance > 0)) {
      return NextResponse.json({ error: "invalid_calibration" }, { status: 422 });
    }
    const result = await calibrate(sheetId, { p1, p2, real_distance_ft: realDistance });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return takeoffErrorResponse(err);
  }
}
