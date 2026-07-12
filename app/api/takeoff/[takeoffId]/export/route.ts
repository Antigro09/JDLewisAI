import { NextRequest } from "next/server";
import { createExportAndDownload } from "@/lib/takeoff-engine/client";
import { requireTakeoff, takeoffErrorResponse } from "@/lib/takeoff-engine/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ takeoffId: string }> },
) {
  try {
    const { takeoffId } = await params;
    const { row } = await requireTakeoff(takeoffId);
    const body = await req.json().catch(() => ({}));
    const format = typeof body.format === "string" ? body.format : "xlsx";
    const download = await createExportAndDownload(row.engineProjectId, format);
    return new Response(download.body, {
      status: download.status,
      headers: {
        "Content-Type": download.headers.get("Content-Type") ?? "application/octet-stream",
        "Content-Disposition":
          download.headers.get("Content-Disposition") ?? `attachment; filename="takeoff.${format}"`,
      },
    });
  } catch (err) {
    return takeoffErrorResponse(err);
  }
}
