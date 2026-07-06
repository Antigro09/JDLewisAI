import { describe, expect, it, vi } from "vitest";
import { runLocalTool } from "@/lib/tools/local-tools";

// local-tools imports lib/memory (→ lib/db) for save_memory; stub it so the
// pure calculators can be tested without a database.
vi.mock("@/lib/memory", () => ({
  MEMORY_CATEGORIES: [{ id: "other", label: "Other" }],
  createMemory: vi.fn(async () => {}),
}));

const USER = "user-1";

async function runJson(name: string, input: Record<string, unknown>) {
  const result = await runLocalTool(USER, name, input);
  expect(result.isError).toBeUndefined();
  return { json: JSON.parse(result.output), summary: result.summary };
}

describe("calculate_concrete", () => {
  it("computes cubic yards with the default 10% waste", async () => {
    // 20ft × 10ft × 4in = 66.667 cu ft = 2.469 CY
    const { json, summary } = await runJson("calculate_concrete", {
      lengthFt: 20,
      widthFt: 10,
      thicknessIn: 4,
    });
    expect(json).toEqual({ cubicYards: 2.47, orderQtyWithWaste: 2.72, wastePct: 10 });
    expect(summary).toBe("Concrete: 2.47 CY (2.72 CY w/ 10% waste)");
  });

  it("honors a custom waste percentage", async () => {
    const { json } = await runJson("calculate_concrete", {
      lengthFt: 20,
      widthFt: 10,
      thicknessIn: 4,
      wastePct: 5,
    });
    expect(json).toEqual({ cubicYards: 2.47, orderQtyWithWaste: 2.59, wastePct: 5 });
  });

  it("coerces numeric strings", async () => {
    const { json } = await runJson("calculate_concrete", {
      lengthFt: "20",
      widthFt: "10",
      thicknessIn: "4",
    });
    expect(json.cubicYards).toBe(2.47);
  });

  it("returns zero volume for zero thickness (current behavior, no validation)", async () => {
    const { json } = await runJson("calculate_concrete", {
      lengthFt: 20,
      widthFt: 10,
      thicknessIn: 0,
    });
    expect(json).toEqual({ cubicYards: 0, orderQtyWithWaste: 0, wastePct: 10 });
  });
});

describe("calculate_rebar", () => {
  it("computes weight from the bar-size table", async () => {
    // #4 = 0.668 lbs/ft
    const { json } = await runJson("calculate_rebar", { barSize: "#4", totalLengthFt: 100 });
    expect(json).toEqual({ barSize: "#4", totalLengthFt: 100, weightLbs: 66.8, tons: 0.033 });
  });

  it("tolerates whitespace in the bar size", async () => {
    const { json } = await runJson("calculate_rebar", { barSize: "# 5", totalLengthFt: 100 });
    expect(json).toEqual({ barSize: "#5", totalLengthFt: 100, weightLbs: 104.3, tons: 0.052 });
  });

  it("errors on an unknown bar size", async () => {
    const result = await runLocalTool(USER, "calculate_rebar", {
      barSize: "#12",
      totalLengthFt: 100,
    });
    expect(result.isError).toBe(true);
    expect(result.summary).toBe("Unknown rebar size");
  });

  it("returns zero weight for zero length (current behavior, no validation)", async () => {
    const { json } = await runJson("calculate_rebar", { barSize: "#4", totalLengthFt: 0 });
    expect(json.weightLbs).toBe(0);
  });
});

describe("calculate_pipe_volume", () => {
  it("computes internal volume in gallons", async () => {
    // 6" ID ≈ 1.469 gal/ft → 146.88 gal per 100 ft
    const { json } = await runJson("calculate_pipe_volume", { diameterIn: 6, lengthFt: 100 });
    expect(json).toEqual({ cubicFeet: 19.635, gallons: 146.88 });
  });

  it("returns zero for a zero diameter (current behavior, no validation)", async () => {
    const { json } = await runJson("calculate_pipe_volume", { diameterIn: 0, lengthFt: 100 });
    expect(json).toEqual({ cubicFeet: 0, gallons: 0 });
  });
});

describe("calculate_voltage_drop", () => {
  it("computes single-phase copper drop (defaults) and flags >3%", async () => {
    // vd = 2 × 12.9 × 20A × 50ft / 6530 cmil = 3.95 V on 120 V → 3.29%
    const { json, summary } = await runJson("calculate_voltage_drop", {
      amps: 20,
      lengthFt: 50,
      conductorAwg: "12",
      voltage: 120,
    });
    expect(json).toMatchObject({ voltageDrop: 3.95, percent: 3.29, acceptable: false });
    expect(summary).toContain("exceeds 3%");
  });

  it("computes three-phase aluminum drop with a large conductor", async () => {
    // vd = √3 × 21.2 × 100A × 200ft / 211600 cmil = 3.47 V on 480 V → 0.72%
    const { json, summary } = await runJson("calculate_voltage_drop", {
      amps: 100,
      lengthFt: 200,
      conductorAwg: "4/0",
      voltage: 480,
      phase: 3,
      material: "aluminum",
    });
    expect(json).toMatchObject({ voltageDrop: 3.47, percent: 0.72, acceptable: true });
    expect(summary).not.toContain("exceeds");
  });

  it("errors on an unknown conductor size", async () => {
    const result = await runLocalTool(USER, "calculate_voltage_drop", {
      amps: 20,
      lengthFt: 50,
      conductorAwg: "13",
      voltage: 120,
    });
    expect(result.isError).toBe(true);
    expect(result.summary).toBe("Unknown conductor size");
  });
});

describe("calculate_hvac_load", () => {
  it("applies the default 450 sq ft/ton rule of thumb", async () => {
    const { json } = await runJson("calculate_hvac_load", { areaSqFt: 1800 });
    expect(json).toMatchObject({ tons: 4, btuh: 48000 });
  });

  it("honors a custom sq ft/ton figure", async () => {
    const { json } = await runJson("calculate_hvac_load", { areaSqFt: 1800, sqFtPerTon: 600 });
    expect(json).toMatchObject({ tons: 3, btuh: 36000 });
  });

  it("returns zero tons for zero area (current behavior, no validation)", async () => {
    const { json } = await runJson("calculate_hvac_load", { areaSqFt: 0 });
    expect(json).toMatchObject({ tons: 0, btuh: 0 });
  });
});

describe("runLocalTool dispatch", () => {
  it("errors on an unknown tool name", async () => {
    const result = await runLocalTool(USER, "not_a_tool", {});
    expect(result.isError).toBe(true);
    expect(result.output).toBe("Unknown tool: not_a_tool");
  });
});
