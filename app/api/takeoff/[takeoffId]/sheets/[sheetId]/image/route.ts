import { getSheetImage } from "@/lib/takeoff-engine/client";
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
    const image = await getSheetImage(sheetId);
    return new Response(image.body, {
      status: image.status,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    return takeoffErrorResponse(err);
  }
}
