/** Reasoning / operating modes: presets that shape how the AI approaches a
 * message. Each appends a short note to the system prompt for that message. */
export type ReasoningMode = {
  id: string;
  label: string;
  note: string;
};

export const REASONING_MODES: ReasoningMode[] = [
  { id: "standard", label: "Standard", note: "" },
  {
    id: "quick",
    label: "Quick answer",
    note: "Quick-answer mode: be direct and concise. Give the answer first in 1–3 sentences, then only essential detail. Skip preamble.",
  },
  {
    id: "plan_review",
    label: "Plan review",
    note: "Plan-review mode: read the drawings/specs carefully. Report sheet-by-sheet what you see, key quantities, coordination conflicts, missing information, and questions for the design team. Flag anything unreadable rather than guessing.",
  },
  {
    id: "estimating",
    label: "Estimating",
    note: "Estimating mode: work like a senior estimator. Do a systematic takeoff (use the calculator tools), organize by CSI division, state every assumption and inclusion/exclusion, apply reasonable waste, and clearly separate quantities from pricing. Note where real vendor pricing is needed.",
  },
  {
    id: "safety_review",
    label: "Safety review",
    note: "Safety-review mode: identify hazards by task (JHA-style), required controls and PPE, and applicable OSHA 1926 areas (never fabricate citation numbers). Call out high-risk activities (fall, electrical/LOTO, excavation, crane/rigging, confined space) prominently.",
  },
  {
    id: "contract_analysis",
    label: "Contract analysis",
    note: "Contract-analysis mode: analyze terms precisely. Identify obligations, risk-shifting clauses (indemnity, consequential-damages waivers, no-damage-for-delay, pay-if-paid), notice requirements and deadlines, and flag anything unusual or one-sided. Quote the exact language you are analyzing. You are not giving legal advice — recommend counsel review for legal conclusions.",
  },
  {
    id: "scheduling",
    label: "Scheduling",
    note: "Scheduling mode: think in terms of activities, durations, logic ties, and the critical path. When analyzing delays, identify impacts, float, and recovery options (re-sequencing, crews, shifts, fast-tracking). Be explicit that estimates are planning-level, not a CPM update.",
  },
  {
    id: "cost_analysis",
    label: "Cost analysis",
    note: "Cost-analysis mode: break costs down clearly (labor, material, equipment, subs, GCs, OH&P). Show unit costs and math, compare alternatives, and flag cost risks and assumptions. Distinguish estimated from confirmed pricing.",
  },
  {
    id: "executive_summary",
    label: "Executive summary",
    note: "Executive-summary mode: write for an owner/executive. Lead with the bottom line, then 3–6 crisp bullets (status, budget, schedule, risks, decisions needed). Keep it brief and non-technical; put detail in a short appendix only if essential.",
  },
  {
    id: "deep_research",
    label: "Deep research",
    note: "Deep-research mode: investigate thoroughly using every available tool (including web search) before answering. Cross-check across sources, cite references, and clearly separate what's confirmed from what's inferred or uncertain.",
  },
];

export function getMode(id: string | undefined): ReasoningMode | undefined {
  if (!id) return undefined;
  return REASONING_MODES.find((m) => m.id === id);
}
