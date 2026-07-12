import { describe, expect, it } from "vitest";
import type { EngineQuantity } from "@/lib/takeoff-engine/types";
import {
  AUTO_ACCEPT_STORAGE_KEY,
  nextAutoAcceptTarget,
  readAutoAcceptSetting,
  writeAutoAcceptSetting,
} from "./auto-accept";
import { quantityAuditNote } from "./review-audit-note";

function quantity(patch: Partial<EngineQuantity>): EngineQuantity {
  return {
    id: patch.id ?? "q1",
    project_id: "p1",
    sheet_id: "s1",
    page_number: 1,
    item_type: patch.item_type ?? "door",
    description: patch.description ?? "Doors",
    quantity: patch.quantity ?? 1,
    unit: patch.unit ?? "EA",
    formula: patch.formula ?? "engine",
    final_confidence: patch.final_confidence,
    needs_review: patch.needs_review ?? false,
    review_status: patch.review_status ?? "pending",
    attributes: patch.attributes ?? {},
  };
}

describe("quantityAuditNote", () => {
  it("shows door symbols separately from scheduled marks", () => {
    expect(quantityAuditNote(quantity({
      item_type: "door",
      quantity: 22,
      attributes: { symbol_count: 22, unique_mark_count: 17 },
    }))).toBe("22 symbols / 17 scheduled marks");
  });

  it("shows schedule-backed openings and ETR exclusions", () => {
    expect(quantityAuditNote(quantity({
      item_type: "door",
      quantity: 19,
      attributes: {
        count_basis: "scheduled_plan_marks",
        opening_count: 19,
        schedule_row_count: 20,
        existing_schedule_marks_excluded: ["100A"],
      },
    }))).toBe("19 scheduled openings / 20 schedule rows / ETR excluded: 100A");
  });

  it("shows wall segment audit counts", () => {
    expect(quantityAuditNote(quantity({
      item_type: "wall",
      quantity: 94.68,
      unit: "LF",
      attributes: { segment_count: 14 },
    }))).toBe("14 wall segments");
  });

  it("shows flooring printed-label basis", () => {
    expect(quantityAuditNote(quantity({
      item_type: "flooring",
      quantity: 3689.4,
      unit: "SF",
      attributes: { base_sqft: 3354, label_area_count: 13 },
    }))).toBe("3,354 base SF from 13 room labels");
  });
});

describe("auto-accept high confidence", () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
  }

  /** Mirrors the client effect: accept one target at a time until none remain. */
  function drainAutoAccepts(
    enabled: boolean,
    quantities: EngineQuantity[],
    dispatched: Set<string>,
  ): { accepted: string[]; remaining: EngineQuantity[] } {
    const accepted: string[] = [];
    let remaining = quantities;
    for (;;) {
      const target = nextAutoAcceptTarget(enabled, remaining, dispatched);
      if (!target) return { accepted, remaining };
      dispatched.add(target.id);
      accepted.push(target.id);
      remaining = remaining.filter((q) => q.id !== target.id);
    }
  }

  it("defaults to off and accepts nothing while off", () => {
    expect(readAutoAcceptSetting(fakeStorage())).toBe(false);
    expect(readAutoAcceptSetting(null)).toBe(false);

    const { accepted } = drainAutoAccepts(
      false,
      [quantity({ id: "q1", final_confidence: 0.99 })],
      new Set(),
    );
    expect(accepted).toEqual([]);
  });

  it("toggling on auto-accepts the current high-confidence items", () => {
    const store = fakeStorage();
    writeAutoAcceptSetting(store, true);
    expect(readAutoAcceptSetting(store)).toBe(true);
    expect(store.getItem(AUTO_ACCEPT_STORAGE_KEY)).toBe("true");

    const { accepted, remaining } = drainAutoAccepts(
      true,
      [
        quantity({ id: "q1", final_confidence: 0.85 }),
        quantity({ id: "q2", final_confidence: 0.84 }),
        quantity({ id: "q3", final_confidence: 0.99 }),
        quantity({ id: "q4" }),
      ],
      new Set(),
    );
    expect(accepted).toEqual(["q1", "q3"]);
    expect(remaining.map((q) => q.id)).toEqual(["q2", "q4"]);
  });

  it("auto-accepts items that arrive while the toggle is on", () => {
    const dispatched = new Set<string>();
    const first = drainAutoAccepts(true, [quantity({ id: "q1", final_confidence: 0.9 })], dispatched);
    expect(first.accepted).toEqual(["q1"]);

    const arrived = drainAutoAccepts(
      true,
      [
        quantity({ id: "q2", final_confidence: 0.95 }),
        quantity({ id: "q3", final_confidence: 0.5 }),
      ],
      dispatched,
    );
    expect(arrived.accepted).toEqual(["q2"]);
  });

  it("does not re-dispatch an item that was already auto-accepted", () => {
    const dispatched = new Set(["q1"]);
    expect(nextAutoAcceptTarget(true, [quantity({ id: "q1", final_confidence: 0.9 })], dispatched)).toBeNull();
  });

  it("toggling off stops auto-accepting arriving items", () => {
    const store = fakeStorage({ [AUTO_ACCEPT_STORAGE_KEY]: "true" });
    writeAutoAcceptSetting(store, false);
    expect(readAutoAcceptSetting(store)).toBe(false);

    const dispatched = new Set<string>();
    drainAutoAccepts(true, [quantity({ id: "q1", final_confidence: 0.9 })], dispatched);
    const afterOff = drainAutoAccepts(
      false,
      [quantity({ id: "q2", final_confidence: 0.99 })],
      dispatched,
    );
    expect(afterOff.accepted).toEqual([]);
  });
});
