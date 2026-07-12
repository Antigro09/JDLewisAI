import { NextRequest, NextResponse } from "next/server";
import { listQuantities } from "@/lib/takeoff-engine/client";
import { requireTakeoff, takeoffErrorResponse } from "@/lib/takeoff-engine/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function boolParam(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ takeoffId: string }> },
) {
  try {
    const { takeoffId } = await params;
    const { row } = await requireTakeoff(takeoffId);
    const quantities = await listQuantities(row.engineProjectId, {
      needs_review: boolParam(req.nextUrl.searchParams.get("needs_review")),
      item_type: req.nextUrl.searchParams.get("item_type") ?? undefined,
    });
    return NextResponse.json({ quantities });
  } catch (err) {
    return takeoffErrorResponse(err);
  }
}
