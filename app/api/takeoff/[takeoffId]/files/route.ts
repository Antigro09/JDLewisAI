import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { takeoffProjects } from "@/lib/db/schema";
import { uploadFile } from "@/lib/takeoff-engine/client";
import { requireTakeoff, takeoffErrorResponse } from "@/lib/takeoff-engine/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "image/tiff", "image/tif"]);
const ALLOWED_EXT = /\.(pdf|tif|tiff)$/i;

function accepted(file: File): boolean {
  if (ALLOWED_TYPES.has(file.type)) return true;
  if (file.type === "" || file.type === "application/octet-stream") {
    return ALLOWED_EXT.test(file.name);
  }
  return false;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ takeoffId: string }> },
) {
  try {
    const { takeoffId } = await params;
    const { row } = await requireTakeoff(takeoffId);
    const contentLength = Number(req.headers.get("content-length") ?? 0);
    if (contentLength > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "oversize_upload" }, { status: 413 });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "missing_file" }, { status: 422 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "oversize_upload" }, { status: 413 });
    }
    if (!accepted(file)) {
      return NextResponse.json({ error: "unsupported_type" }, { status: 415 });
    }

    const forwarded = new File([await file.arrayBuffer()], file.name, { type: file.type });
    const uploaded = await uploadFile(row.engineProjectId, forwarded);
    await db
      .update(takeoffProjects)
      .set({ status: "uploading", updatedAt: new Date() })
      .where(eq(takeoffProjects.id, row.id));

    return NextResponse.json({ file: uploaded }, { status: 201 });
  } catch (err) {
    return takeoffErrorResponse(err);
  }
}
