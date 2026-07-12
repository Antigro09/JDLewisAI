import { describe, expect, it } from "vitest";
import { buildReportFromMeasurements, type Measurement } from "./material-takeoff";

function slab(quantity: number, slabSf?: number): Measurement {
  return {
    kind: "volume",
    quantity,
    unit: "CY",
    trade: "concrete",
    assemblyId: "concrete-slab",
    label: `Slab ${quantity}`,
    sheetRef: "A-101 p.1",
    basis: `${quantity} CY`,
    source: "traced",
    assumptions: [],
    assemblyParams: slabSf === undefined ? undefined : { slabSf },
  };
}

describe("buildReportFromMeasurements", () => {
  it("merges per-measurement slabSf after global overrides", () => {
    const report = buildReportFromMeasurements([slab(10, 1000), slab(5, 300)], {
      sheets: [],
    });
    const lines = report.divisions.flatMap((d) => d.trades.flatMap((t) => t.materials));
    const mesh = lines.find((line) => line.description.includes("WWM sheet"));
    const vapor = lines.find((line) => line.description.includes("vapor barrier"));

    expect(mesh?.quantityExact).toBeCloseTo(29.9, 3);
    expect(mesh?.quantityPurchase).toBe(30);
    expect(vapor?.quantityExact).toBeCloseTo(1.43, 3);
  });

  it("keeps the concrete slab default when slabSf is absent", () => {
    const report = buildReportFromMeasurements([slab(1)], { sheets: [] });
    const lines = report.divisions.flatMap((d) => d.trades.flatMap((t) => t.materials));
    const mesh = lines.find((line) => line.description.includes("WWM sheet"));
    expect(mesh?.quantityExact).toBeCloseTo(1.863, 3);
  });
});
