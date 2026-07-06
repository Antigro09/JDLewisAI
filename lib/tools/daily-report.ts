import { generateStructured, type GenerateResult } from "@/lib/claude/chat";

export type DailyReportResult = {
  report: string;
  usage: GenerateResult;
};

const SYSTEM = `You are a construction superintendent writing a formal daily site report.
Output a JSON object with a single key "report" containing the full daily report as
a well-formatted string (use \\n for newlines). Include sections for:
- Report Date & Project
- Weather Conditions
- Personnel / Labor on Site
- Work Performed Today (organized by trade or area)
- Materials Received
- Equipment on Site
- Issues / Delays / Safety Incidents
- Visitors
- Work Planned for Tomorrow
Fill in from the provided details; use "None reported" for sections with no info.
Keep a professional, factual tone.`;

/** Enforced via structured outputs — the report is the whole payload. */
const REPORT_SCHEMA = {
  type: "object",
  properties: {
    report: { type: "string" },
  },
  required: ["report"],
  additionalProperties: false,
};

export async function generateDailyReport(opts: {
  reportDate: string;
  projectName?: string;
  weather?: string;
  laborNotes?: string;
  workPerformed?: string;
  issues?: string;
  model?: string;
  effort?: string;
}): Promise<DailyReportResult> {
  const ctx: string[] = [`Report Date: ${opts.reportDate}`];
  if (opts.projectName) ctx.push(`Project: ${opts.projectName}`);
  if (opts.weather) ctx.push(`Weather: ${opts.weather}`);
  if (opts.laborNotes) ctx.push(`Labor Notes:\n${opts.laborNotes}`);
  if (opts.workPerformed) ctx.push(`Work Performed:\n${opts.workPerformed}`);
  if (opts.issues) ctx.push(`Issues / Delays:\n${opts.issues}`);

  const { data, ...meta } = await generateStructured<{ report?: string }>({
    model: opts.model,
    effort: opts.effort ?? "medium",
    system: SYSTEM,
    maxTokens: 3000,
    schema: REPORT_SCHEMA,
    schemaName: "daily_report",
    turns: [
      {
        role: "user",
        text: `Generate a daily site report:\n\n${ctx.join("\n")}`,
      },
    ],
  });
  // Structured path returns parsed data, not raw text — keep the GenerateResult
  // shape callers meter against.
  const usage: GenerateResult = { text: "", ...meta };

  // Empty only if even generateStructured's fallback ladder produced nothing.
  const report = typeof data?.report === "string" ? data.report : "";
  return { report, usage };
}
