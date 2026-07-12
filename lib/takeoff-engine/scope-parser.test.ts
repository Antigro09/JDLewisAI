import { describe, expect, it } from "vitest";
import { parseTakeoffScope } from "./scope-parser";
import type { EngineSheet } from "./types";

const sheets: EngineSheet[] = [
  { id: "sheet-a100", page_number: 1, sheet_number: "A1.00" },
  { id: "sheet-a800", page_number: 3, sheet_number: "A8.00" },
  { id: "sheet-a810", page_number: 2, sheet_number: "A8.10" },
];

describe("parseTakeoffScope", () => {
  it("parses column takeoff instructions", () => {
    const scope = parseTakeoffScope("do column takeoffs on A1.00", sheets);

    expect(scope.requests).toEqual([
      {
        trade: "columns",
        sheet_refs: ["A1.00"],
        sheet_ids: ["sheet-a100"],
        include_existing: false,
      },
    ]);
  });

  it("includes columns in the all-trades fallback for explicit sheet-only requests", () => {
    const scope = parseTakeoffScope("takeoff A8.10", sheets);

    expect(scope.requests.map((request) => request.trade)).toEqual([
      "walls",
      "doors",
      "flooring",
      "columns",
    ]);
  });

  it("keeps comma-separated trade lists scoped to their shared sheet ref", () => {
    const scope = parseTakeoffScope("walls, doors, and columns on A1.00; flooring on A8.10", sheets);

    expect(scope.requests.map((request) => [request.trade, request.sheet_refs])).toEqual([
      ["walls", ["A1.00"]],
      ["doors", ["A1.00"]],
      ["columns", ["A1.00"]],
      ["flooring", ["A8.10"]],
    ]);
  });

  it("splits independent requests joined by and", () => {
    const scope = parseTakeoffScope("do door takeoffs on A1.00 and floor takeoffs on A8.00", sheets);

    expect(scope.requests.map((request) => [request.trade, request.sheet_refs, request.sheet_ids])).toEqual([
      ["doors", ["A1.00"], ["sheet-a100"]],
      ["flooring", ["A8.00"], ["sheet-a800"]],
    ]);
  });

  it("carries a trade over repeated sheet references", () => {
    const scope = parseTakeoffScope("walls on A1.00 and A8.10", sheets);

    expect(scope.requests.map((request) => [request.trade, request.sheet_refs])).toEqual([
      ["walls", ["A1.00"]],
      ["walls", ["A8.10"]],
    ]);
  });
});
