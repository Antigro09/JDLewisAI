import { NextRequest, NextResponse } from "next/server";
import { reviewQuantity } from "@/lib/takeoff-engine/client";
import {
  assertQuantityInProject,
  requireTakeoff,
  takeoffErrorResponse,
} from "@/lib/takeoff-engine/auth";
import type { ReviewAction } from "@/lib/takeoff-engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set<ReviewAction>(["accept", "edit", "reject"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ takeoffId: string; qid: string }> },
) {
  try {
    const { takeoffId, qid } = await params;
    const { user, row } = await requireTakeoff(takeoffId);
    await assertQuantityInProject(row.engineProjectId, qid);
    const body = await req.json().catch(() => ({}));
    const action = body.action as ReviewAction;
    if (!ACTIONS.has(action)) {
      return NextResponse.json({ error: "invalid_action" }, { status: 422 });
    }
    if (action === "edit" && body.corrected_quantity == null) {
      return NextResponse.json({ error: "edit_missing_quantity" }, { status: 422 });
    }
    const result = await reviewQuantity(qid, {
      action,
      corrected_quantity:
        body.corrected_quantity == null ? null : Number(body.corrected_quantity),
      corrected_unit: typeof body.corrected_unit === "string" ? body.corrected_unit : null,
      corrected_description:
        typeof body.corrected_description === "string" ? body.corrected_description : null,
      corrected_geometry: Array.isArray(body.corrected_geometry) ? body.corrected_geometry : null,
      comment: typeof body.comment === "string" ? body.comment : "",
      reviewer: user.name || user.email,
    });
    return NextResponse.json(result);
  } catch (err) {
    return takeoffErrorResponse(err);
  }
}
