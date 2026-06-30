import { generate, extractJson, type GenerateResult } from "@/lib/claude/chat";

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

export type DoorFramingTakeoff = {
  doors: {
    id: string;
    type: string;
    widthIn?: number;
    heightIn?: number;
    swing?: string;
    count: number;
    location?: string;
  }[];
  totalDoors: number;
  framingLinearFeet: number;
  framingNotes?: string;
  assumptions: string[];
};

const TAKEOFF_SYSTEM = `You are a construction plan reviewer producing a door inventory and a rough
framing material takeoff from a single architectural plan sheet (image or PDF).

1. Inventory every door visible on the sheet: type (e.g. "hollow core", "solid core", "fire-rated",
   "double"), approximate width/height in inches if dimensioned or in a door schedule, swing
   direction (e.g. "left-hand", "right-hand", "double", "sliding") if shown, count of identical
   doors, and a short location/room label.
2. Given the supplied wall thickness, stud spacing, and stud size, estimate total linear footage of
   wall framing material needed by reasoning about wall lengths visible/dimensioned on the sheet.
   Where a wall length isn't directly dimensioned, state that assumption explicitly rather than
   inventing a precise number.
3. List every assumption you made in "assumptions" — this is read by the user before they trust the
   numbers, so be specific and complete.

Output STRICT JSON only, matching exactly this shape:
{
  "doors": [{"id": string, "type": string, "widthIn": number, "heightIn": number, "swing": string, "count": number, "location": string}],
  "totalDoors": number,
  "framingLinearFeet": number,
  "framingNotes": string,
  "assumptions": string[]
}
If you genuinely cannot read door or wall information from the sheet, say so in "assumptions" and
return conservative (possibly zero) numbers rather than guessing.`;

export async function analyzeDoorFramingTakeoff(opts: {
  fileBase64: string;
  mime: string;
  fileName: string;
  wallThicknessIn: number;
  studSpacingIn: number;
  studSize: string;
  model?: string;
  effort?: string;
}): Promise<{ data: DoorFramingTakeoff; usage: GenerateResult }> {
  const usage = await generate({
    model: opts.model,
    effort: opts.effort ?? "high",
    system: TAKEOFF_SYSTEM,
    maxTokens: 4000,
    turns: [
      {
        role: "user",
        text: `Wall thickness: ${opts.wallThicknessIn} in. Stud spacing: ${opts.studSpacingIn} in
o.c. Stud size: ${opts.studSize}. Inventory doors and estimate framing linear footage. Return
JSON only.`,
        attachments: [
          { mime: opts.mime, name: opts.fileName, dataBase64: opts.fileBase64 },
        ],
      },
    ],
  });

  const parsed = extractJson<Partial<DoorFramingTakeoff>>(usage.text);
  const data: DoorFramingTakeoff = {
    doors: Array.isArray(parsed?.doors) ? parsed!.doors : [],
    totalDoors:
      typeof parsed?.totalDoors === "number"
        ? parsed.totalDoors
        : (parsed?.doors ?? []).reduce((n, d) => n + (Number(d.count) || 0), 0),
    framingLinearFeet:
      typeof parsed?.framingLinearFeet === "number" ? parsed.framingLinearFeet : 0,
    framingNotes: parsed?.framingNotes,
    assumptions: Array.isArray(parsed?.assumptions) ? parsed!.assumptions : [],
  };
  return { data, usage };
}
