import { describe, expect, it } from "vitest";
import { buildReportFromEngineData } from "./bridge";
import type { EngineCorrection, EngineQuantity, EngineSheet } from "./types";

const sheet: EngineSheet = {
  id: "sheet-1",
  page_number: 1,
  sheet_number: "A-101",
  width_pt: 100,
  height_pt: 100,
};

function quantity(patch: Partial<EngineQuantity>): EngineQuantity {
  return {
    id: patch.id ?? "q1",
    project_id: "ep1",
    sheet_id: "sheet-1",
    page_number: 1,
    item_type: patch.item_type ?? "flooring",
    description: patch.description ?? "Room finish",
    quantity: patch.quantity ?? 100,
    unit: patch.unit ?? "SF",
    formula: patch.formula ?? "engine",
    source_geometry_ids: patch.source_geometry_ids ?? ["g1"],
    source_ocr_span_ids: [],
    final_confidence: patch.final_confidence ?? 0.95,
    needs_review: patch.needs_review ?? false,
    review_reason: patch.review_reason ?? [],
    review_status: patch.review_status ?? "pending",
    attributes: patch.attributes ?? {},
  };
}

describe("takeoff engine bridge", () => {
  it("uses base flooring sqft and per-slab area without dropping raw mapped items", () => {
    const result = buildReportFromEngineData({
      sheets: [sheet],
      quantities: [
        quantity({
          id: "slab",
          item_type: "concrete_slab",
          description: "6 inch slab",
          quantity: 9.26,
          unit: "CY",
          review_status: "accepted",
          attributes: { sqft: 500 },
          source_geometry_ids: ["slab-geom"],
        }),
        quantity({
          id: "floor",
          item_type: "flooring",
          quantity: 110,
          unit: "SF",
          review_status: "accepted",
          attributes: { base_sqft: 100 },
          source_geometry_ids: ["floor-geom"],
        }),
        quantity({
          id: "door",
          item_type: "door",
          description: "Door symbols",
          quantity: 3,
          unit: "EA",
          review_status: "accepted",
          source_geometry_ids: ["door-geom"],
        }),
      ],
    });

    const lines = result.report.divisions.flatMap((d) => d.trades.flatMap((t) => t.materials));
    const mesh = lines.find((line) => line.description.includes("WWM sheet"));
    const vct = lines.find((line) => line.description.includes("VCT"));
    const door = lines.find((line) => line.description.includes("Door symbols"));

    expect(mesh?.quantityExact).toBeCloseTo(11.5, 3);
    expect(vct?.quantityExact).toBeCloseTo(2.444, 3);
    expect(door?.csiDivision).toBe("08");
    expect(result.includedQuantityIds).toEqual(["slab", "floor", "door"]);
  });

  it("surfaces door symbol count versus scheduled mark count", () => {
    const result = buildReportFromEngineData({
      sheets: [sheet],
      quantities: [
        quantity({
          id: "door",
          item_type: "door",
          description: "Doors (symbol count)",
          quantity: 5,
          unit: "EA",
          review_status: "accepted",
          attributes: {
            symbol_count: 5,
            unique_mark_count: 3,
            unmatched_symbol_count: 1,
            mark_counts: { "100A": 2, "100B": 2, "101": 1 },
          },
        }),
      ],
    });

    const measurement = result.report.measurements[0];
    const line = result.report.divisions
      .flatMap((division) => division.trades)
      .flatMap((trade) => trade.materials)
      .find((material) => material.description.includes("Doors (symbol count)"));

    expect(measurement.assumptions).toContain("Count basis: 5 accepted symbols; 3 unique scheduled marks");
    expect(measurement.assumptions).toContain(
      "Duplicate scheduled marks represented by multiple symbols/leaves: 100A x2, 100B x2",
    );
    expect(measurement.assumptions).toContain("1 accepted symbol had no matched schedule mark.");
    expect(line?.assumptions).toContain("Count basis: 5 accepted symbols; 3 unique scheduled marks");
  });

  it("uses schedule-backed door openings and explains ETR exclusions", () => {
    const result = buildReportFromEngineData({
      sheets: [sheet],
      quantities: [
        quantity({
          id: "door",
          item_type: "door",
          description: "Doors (scheduled openings)",
          quantity: 19,
          unit: "EA",
          review_status: "accepted",
          attributes: {
            count_basis: "scheduled_plan_marks",
            opening_count: 19,
            schedule_row_count: 20,
            existing_schedule_marks_excluded: ["100A"],
          },
        }),
      ],
    });

    const assumptions = result.report.measurements[0].assumptions;
    expect(assumptions).toContain(
      "Count basis: 19 scheduled openings shown on scoped plan; 20 door schedule rows",
    );
    expect(assumptions).toContain("Existing/ETR door schedule marks excluded: 100A");
  });

  it("applies a corrections-log edit by geometry after reprocess resets status", () => {
    const current = quantity({
      id: "new-id",
      quantity: 10,
      needs_review: true,
      review_status: "pending",
      source_geometry_ids: ["same-geom"],
    });
    const correction: EngineCorrection = {
      id: "decision-1",
      quantity_item_id: "old-id",
      action: "edit",
      corrected_quantity: 12,
      machine_snapshot: {
        id: "old-id",
        project_id: "ep1",
        sheet_id: "sheet-1",
        page_number: 1,
        item_type: "flooring",
        description: "Room finish",
        quantity: 10,
        unit: "SF",
        formula: "old",
        source_geometry_ids: ["same-geom"],
        needs_review: true,
        review_status: "accepted",
      },
    };

    const result = buildReportFromEngineData({
      sheets: [sheet],
      quantities: [current],
      corrections: [correction],
    });

    expect(result.report.measurements[0].quantity).toBe(12);
    expect(result.includedQuantityIds).toEqual(["new-id"]);
  });

  it("flags ambiguous correction matches instead of applying them", () => {
    const correction: EngineCorrection = {
      id: "decision-1",
      quantity_item_id: "old-id",
      action: "accept",
      machine_snapshot: {
        sheet_id: "sheet-1",
        item_type: "flooring",
        quantity: 10,
        unit: "SF",
        description: "Room finish",
        source_geometry_ids: ["same-geom"],
      },
    };

    const result = buildReportFromEngineData({
      sheets: [sheet],
      quantities: [
        quantity({ id: "a", needs_review: true, source_geometry_ids: ["same-geom"] }),
        quantity({ id: "b", needs_review: true, source_geometry_ids: ["same-geom"] }),
      ],
      corrections: [correction],
    });

    expect(result.report.measurements).toHaveLength(0);
    expect(result.report.issues.some((issue) => issue.message.includes("multiple"))).toBe(true);
  });

  it("maps engine columns into concrete count measurements", () => {
    const result = buildReportFromEngineData({
      sheets: [sheet],
      quantities: [
        quantity({
          id: "column",
          item_type: "column",
          description: "Square Columns",
          quantity: 2,
          unit: "EA",
          review_status: "accepted",
          attributes: { shape: "square" },
        }),
      ],
    });

    expect(result.report.measurements[0]).toMatchObject({
      kind: "count",
      quantity: 2,
      unit: "EA",
      trade: "concrete",
      label: "Square Columns",
    });
    expect(result.report.measurements[0].assumptions).toContain("square column");
    expect(result.includedQuantityIds).toEqual(["column"]);
  });

  it("bridges matched wall LF into size-aware framing materials", () => {
    const result = buildReportFromEngineData({
      sheets: [sheet],
      quantities: [
        quantity({
          id: "wall-s2",
          item_type: "wall",
          description: "Wall S2-0-6",
          quantity: 94.68,
          unit: "LF",
          review_status: "pending",
          needs_review: false,
          attributes: { wall_code: "S2-0-6", unit_size_in: 6 },
        }),
      ],
    });

    const lines = result.report.divisions.flatMap((d) => d.trades.flatMap((t) => t.materials));

    expect(result.includedQuantityIds).toEqual(["wall-s2"]);
    expect(result.report.measurements[0]).toMatchObject({
      kind: "length",
      quantity: 94.68,
      unit: "LF",
      trade: "framing",
      label: "Wall S2-0-6",
    });
    expect(lines.some((line) => line.description.includes('6" 25ga metal studs'))).toBe(true);
    expect(lines.some((line) => line.description.includes('6" 25ga track'))).toBe(true);
  });
});
