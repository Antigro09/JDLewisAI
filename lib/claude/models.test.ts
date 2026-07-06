import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  MECHANICAL_MODEL,
  MODELS,
  estimateCostCents,
  getModel,
  resolveModel,
} from "./models";

describe("model registry", () => {
  it("has a default model that is enabled", () => {
    const def = getModel(DEFAULT_MODEL);
    expect(def).toBeDefined();
    expect(def!.enabled).toBe(true);
  });

  it("MECHANICAL_MODEL is a registered, enabled model", () => {
    const m = getModel(MECHANICAL_MODEL);
    expect(m).toBeDefined();
    expect(m!.enabled).toBe(true);
  });

  it("has no duplicate model ids", () => {
    const ids = MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("resolveModel", () => {
  it("keeps a valid model + effort pair", () => {
    const { model, effort } = resolveModel("claude-sonnet-5", "high");
    expect(model.id).toBe("claude-sonnet-5");
    expect(effort).toBe("high");
  });

  it("falls back to the default model for unknown ids", () => {
    const { model } = resolveModel("gpt-7", "high");
    expect(model.id).toBe(DEFAULT_MODEL);
  });

  it("coerces an unknown effort to medium", () => {
    const { effort } = resolveModel("claude-sonnet-5", "turbo");
    expect(effort).toBe("medium");
  });

  it("returns null effort for models without effort control (Haiku)", () => {
    const { model, effort } = resolveModel(MECHANICAL_MODEL, "high");
    expect(model.id).toBe(MECHANICAL_MODEL);
    expect(effort).toBeNull();
  });

  it("coerces xhigh to medium on models without the xhigh level", () => {
    const { effort } = resolveModel("claude-sonnet-4-6", "xhigh");
    expect(effort).toBe("medium");
  });
});

describe("estimateCostCents", () => {
  // claude-sonnet-5: $2/M in, $10/M out.
  it("prices plain input/output tokens", () => {
    const cents = estimateCostCents("claude-sonnet-5", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cents).toBeCloseTo(1200, 6); // $2 + $10 = $12
  });

  it("does not round small costs to zero (fractional cents)", () => {
    // Haiku ($1/M in, $5/M out): 2k in + 500 out = $0.0045 = 0.45¢
    const cents = estimateCostCents(MECHANICAL_MODEL, {
      inputTokens: 2_000,
      outputTokens: 500,
    });
    expect(cents).toBeGreaterThan(0);
    expect(cents).toBeCloseTo(0.45, 6);
  });

  it("bills cache writes at 1.25x input and cache reads at 0.1x input", () => {
    const cents = estimateCostCents("claude-sonnet-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 1_000_000,
      cacheReadInputTokens: 1_000_000,
    });
    // $2 * 1.25 + $2 * 0.1 = $2.70
    expect(cents).toBeCloseTo(270, 6);
  });

  it("returns 0 for unknown models", () => {
    expect(
      estimateCostCents("nope", { inputTokens: 1000, outputTokens: 1000 }),
    ).toBe(0);
  });
});
