import { generate, extractJson, type GenerateResult } from "@/lib/claude/chat";
import type { ScopeSections } from "@/lib/db/schema";

const EMPTY: ScopeSections = {
  workIncluded: [],
  exclusions: [],
  assumptions: [],
  requiredInspections: [],
  requiredPermits: [],
  requiredSubmittals: [],
  closeoutRequirements: [],
};

export type ScopeResult = {
  sections: ScopeSections;
  usage: GenerateResult;
};

const SYSTEM = `You are a senior construction estimator generating a trade Scope of Work.
Produce a thorough, professional scope for the requested trade. Output STRICT JSON only,
no prose, matching exactly this shape:
{
  "workIncluded": string[],
  "exclusions": string[],
  "assumptions": string[],
  "requiredInspections": string[],
  "requiredPermits": string[],
  "requiredSubmittals": string[],
  "closeoutRequirements": string[]
}
Each array should contain 5-12 concise, specific bullet items appropriate to the trade.
Base permits/inspections on typical US commercial practice; where jurisdiction matters,
phrase items generically (e.g. "Rough-in inspection by AHJ"). Do not invent project-specific
quantities unless provided.`;

export async function generateScopeOfWork(opts: {
  trade: string;
  projectName?: string;
  details?: string;
  model?: string;
  effort?: string;
}): Promise<ScopeResult> {
  const ctx: string[] = [`Trade: ${opts.trade}`];
  if (opts.projectName) ctx.push(`Project: ${opts.projectName}`);
  if (opts.details) ctx.push(`Project details / special conditions:\n${opts.details}`);

  const usage = await generate({
    model: opts.model,
    effort: opts.effort ?? "high",
    system: SYSTEM,
    maxTokens: 4000,
    turns: [
      {
        role: "user",
        text: `Generate the Scope of Work JSON for the following.\n\n${ctx.join("\n")}`,
      },
    ],
  });

  const parsed = extractJson<Partial<ScopeSections>>(usage.text);
  const sections: ScopeSections = {
    ...EMPTY,
    ...(parsed ?? {}),
  };
  // Ensure every field is an array of strings.
  (Object.keys(EMPTY) as (keyof ScopeSections)[]).forEach((k) => {
    if (!Array.isArray(sections[k])) sections[k] = [];
    sections[k] = sections[k].map((x) => String(x));
  });

  return { sections, usage };
}

const SECTION_LABELS: { key: keyof ScopeSections; label: string }[] = [
  { key: "workIncluded", label: "Work Included" },
  { key: "exclusions", label: "Exclusions" },
  { key: "assumptions", label: "Assumptions" },
  { key: "requiredInspections", label: "Required Inspections" },
  { key: "requiredPermits", label: "Required Permits" },
  { key: "requiredSubmittals", label: "Required Submittals" },
  { key: "closeoutRequirements", label: "Closeout Requirements" },
];

export function scopeToMarkdown(title: string, s: ScopeSections): string {
  const parts = [`# ${title}`, ""];
  for (const { key, label } of SECTION_LABELS) {
    parts.push(`## ${label}`);
    const items = s[key] ?? [];
    if (items.length === 0) parts.push("- (none)");
    else for (const it of items) parts.push(`- ${it}`);
    parts.push("");
  }
  return parts.join("\n");
}
