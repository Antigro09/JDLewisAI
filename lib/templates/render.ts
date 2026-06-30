import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documentTemplates, type DocumentTemplate } from "@/lib/db/schema";

export async function getOrgTemplate(): Promise<DocumentTemplate | null> {
  const rows = await db
    .select()
    .from(documentTemplates)
    .where(eq(documentTemplates.kind, "general"));
  return rows[0] ?? null;
}
