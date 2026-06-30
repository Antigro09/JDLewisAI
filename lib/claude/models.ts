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
};

export const ALL_EFFORTS: EffortLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export const MODELS: ModelInfo[] = [
  {
    id: "claude-opus-4-8",
    label: "Opus 4.8",
    blurb: "Powerful model for complex work.",
    efforts: ALL_EFFORTS,
    adaptiveThinking: true,
    priceIn: 5,
    priceOut: 25,
    enabled: true,
    default: true,
  },
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    blurb: "Balanced speed, cost, and intelligence.",
    efforts: ALL_EFFORTS,
    adaptiveThinking: true,
    priceIn: 3,
    priceOut: 10,
    enabled: true,
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5",
    blurb: "Fast, near-frontier intelligence at the lowest cost.",
    efforts: [], // Haiku 4.5 does not accept the effort parameter
    adaptiveThinking: false,
    priceIn: 1,
    priceOut: 5,
    enabled: true,
  },
  {
    id: "claude-fable-5",
    label: "Fable 5",
    blurb: "Most powerful frontier model. Temporarily unavailable.",
    efforts: ALL_EFFORTS,
    adaptiveThinking: true,
    priceIn: 10,
    priceOut: 50,
    enabled: false, // temporarily down per company config
  },
];

export const DEFAULT_MODEL =
  MODELS.find((m) => m.default && m.enabled)?.id ?? "claude-opus-4-8";

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
        : "high",
    };
  }
  if (model.efforts.length === 0) return { model, effort: null };
  const e = model.efforts.includes(effort as EffortLevel)
    ? (effort as EffortLevel)
    : "high";
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
