import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { skills } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/server";
import { getSkillFile } from "@/lib/skills";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, fileId } = await params;
  const skill = (await db.select().from(skills).where(eq(skills.id, id)))[0];
  const available = skill && (skill.ownerId === user.id || skill.scope === "org");
  if (!available) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const file = await getSkillFile(fileId);
  if (!file || file.skillId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = Buffer.from(file.data, "base64");
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": file.mime || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${file.name.replace(/"/g, "")}"`,
    },
  });
}
