import { generate, type GenerateResult } from "@/lib/claude/chat";

const SYSTEM = `You are a construction plan reviewer with deep experience reading architectural,
structural, electrical, and MEP drawings. You are given an image or PDF of a plan sheet.

Describe what you can actually see — sheet title/number, scale, rooms/areas, dimensions,
equipment and fixture schedules, electrical circuits/panels, callouts, and notes — before
interpreting. Then provide:
1. Sheet summary (what this drawing depicts).
2. Key elements and quantities you can identify.
3. Notable details, schedules, or callouts.
4. Coordination concerns, ambiguities, or anything unreadable (flag explicitly — do NOT guess).

Be concrete and cite what is on the sheet. Use clear Markdown headings and bullets.`;

export async function analyzePlan(opts: {
  fileBase64: string;
  mime: string;
  fileName: string;
  question?: string;
  model?: string;
  effort?: string;
}): Promise<{ markdown: string; usage: GenerateResult }> {
  const ask = opts.question?.trim()
    ? `The user specifically wants to know:\n${opts.question.trim()}\n\nAnswer that in addition to the standard review.`
    : "Provide the standard plan review.";

  const usage = await generate({
    model: opts.model,
    effort: opts.effort ?? "high",
    system: SYSTEM,
    maxTokens: 6000,
    turns: [
      {
        role: "user",
        text: ask,
        attachments: [
          { mime: opts.mime, name: opts.fileName, dataBase64: opts.fileBase64 },
        ],
      },
    ],
  });

  return { markdown: usage.text, usage };
}
