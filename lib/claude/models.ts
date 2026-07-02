export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export type ModelInfo = {
  id: string;
  label: string;
  blurb: string;
  /** Effort levels the model accepts (empty => model has no effort control). */
  efforts: EffortLevel[];
  /** Whether adaptive extended thinking is supported. */
  adaptiveThinking: boolean;
  /** Pricing per 1M tokens, USD. */
  priceIn: number;
  priceOut: number;
  enabled: boolean;
  default?: boolean;
  /** "primary" shows in the main list; "more" hides behind "More models". */
  tier?: "primary" | "more";
};

export const ALL_EFFORTS: EffortLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

// Effort set for models without the "xhigh"/Extra level.
const EFFORTS_NO_X: EffortLevel[] = ["low", "medium", "high", "max"];

export const MODELS: ModelInfo[] = [
  {
    id: "claude-fable-5",
    label: "Fable 5",
    blurb: "For your toughest challenges.",
    efforts: ALL_EFFORTS,
    adaptiveThinking: true,
    priceIn: 10,
    priceOut: 50,
    enabled: true,
    tier: "primary",
  },
  {
    id: "claude-opus-4-8",
    label: "Opus 4.8",
    blurb: "For complex tasks.",
    efforts: ALL_EFFORTS,
    adaptiveThinking: true,
    priceIn: 5,
    priceOut: 25,
    enabled: true,
    tier: "primary",
  },
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    blurb: "Most efficient for everyday tasks.",
    efforts: ALL_EFFORTS,
    adaptiveThinking: true,
    priceIn: 2,
    priceOut: 10,
    enabled: true,
    default: true,
    tier: "primary",
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5",
    blurb: "Fastest for quick answers.",
    efforts: [], // Haiku 4.5 does not accept the effort parameter
    adaptiveThinking: false,
    priceIn: 1,
    priceOut: 5,
    enabled: true,
    tier: "primary",
  },
  // ---- "More models" (older/legacy) ----
  {
    id: "claude-opus-4-7",
    label: "Opus 4.7",
    blurb: "Previous-generation Opus.",
    efforts: ALL_EFFORTS,
    adaptiveThinking: true,
    priceIn: 5,
    priceOut: 25,
    enabled: true,
    tier: "more",
  },
  {
    id: "claude-opus-4-6",
    label: "Opus 4.6",
    blurb: "Older Opus.",
    efforts: EFFORTS_NO_X,
    adaptiveThinking: true,
    priceIn: 5,
    priceOut: 25,
    enabled: true,
    tier: "more",
  },
  {
    id: "claude-3-opus-20240229",
    label: "Opus 3",
    blurb: "Legacy Opus.",
    efforts: [],
    adaptiveThinking: false,
    priceIn: 15,
    priceOut: 75,
    enabled: true,
    tier: "more",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    blurb: "Previous-generation Sonnet.",
    efforts: EFFORTS_NO_X,
    adaptiveThinking: true,
    priceIn: 3,
    priceOut: 15,
    enabled: true,
    tier: "more",
  },
];

export const DEFAULT_MODEL =
  MODELS.find((m) => m.default && m.enabled)?.id ?? "claude-sonnet-5";

export function getModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

/** Resolve a (model, effort) pair to something the API will accept. */
export function resolveModel(
  modelId: string,
  effort: string,
): { model: ModelInfo; effort: EffortLevel | null } {
  const model = getModel(modelId);
  if (!model || !model.enabled) {
    const fallback = getModel(DEFAULT_MODEL)!;
    return {
      model: fallback,
      effort: fallback.efforts.includes(effort as EffortLevel)
        ? (effort as EffortLevel)
        : "medium",
    };
  }
  if (model.efforts.length === 0) return { model, effort: null };
  const e = model.efforts.includes(effort as EffortLevel)
    ? (effort as EffortLevel)
    : "medium";
  return { model, effort: e };
}

export function estimateCostCents(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const m = getModel(modelId);
  if (!m) return 0;
  const dollars =
    (inputTokens / 1_000_000) * m.priceIn +
    (outputTokens / 1_000_000) * m.priceOut;
  return Math.round(dollars * 100);
}
