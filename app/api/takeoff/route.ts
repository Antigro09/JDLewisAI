import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { takeoffProjects } from "@/lib/db/schema";
import { createProject } from "@/lib/takeoff-engine/client";
import { takeoffErrorResponse } from "@/lib/takeoff-engine/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await db
      .select()
      .from(takeoffProjects)
      .where(eq(takeoffProjects.userId, user.id))
      .orderBy(desc(takeoffProjects.createdAt));
    return NextResponse.json({ takeoffs: rows });
  } catch (err) {
    return takeoffErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : "Untitled takeoff";

    const project = await createProject(name);
    const [row] = await db
      .insert(takeoffProjects)
      .values({
        userId: user.id,
        engineProjectId: project.id,
        name,
        status: "created",
      })
      .returning();

    return NextResponse.json({ takeoff: row }, { status: 201 });
  } catch (err) {
    return takeoffErrorResponse(err);
  }
}
