"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { dailyReports } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";
import { generateDailyReport } from "@/lib/tools/daily-report";
import { recordUsage } from "@/lib/usage";

export async function createDailyReportAction(formData: FormData) {
  const user = await requireUser();
  const reportDate = String(formData.get("reportDate") ?? "").trim();
  if (!reportDate) return;
  const projectId = String(formData.get("projectId") ?? "") || null;
  const weather = String(formData.get("weather") ?? "").trim() || null;
  const laborNotes = String(formData.get("laborNotes") ?? "").trim() || null;
  const workPerformed = String(formData.get("workPerformed") ?? "").trim() || null;
  const issues = String(formData.get("issues") ?? "").trim() || null;
  const model = String(formData.get("model") ?? "") || undefined;
  const effort = String(formData.get("effort") ?? "") || undefined;

  const { report, usage } = await generateDailyReport({
    reportDate,
    weather: weather ?? undefined,
    laborNotes: laborNotes ?? undefined,
    workPerformed: workPerformed ?? undefined,
    issues: issues ?? undefined,
    model,
    effort,
  });
  await recordUsage({
    userId: user.id,
    model: usage.model,
    feature: "daily_report",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });

  const [inserted] = await db
    .insert(dailyReports)
    .values({ userId: user.id, projectId, reportDate, weather, laborNotes, workPerformed, issues, generatedReport: report })
    .returning();

  redirect(`/reports/${inserted.id}`);
}

export async function deleteDailyReportAction(id: string) {
  const user = await requireUser();
  await db.delete(dailyReports).where(and(eq(dailyReports.id, id), eq(dailyReports.userId, user.id)));
  redirect("/reports");
}
