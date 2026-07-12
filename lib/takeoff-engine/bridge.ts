import {
  buildReportFromMeasurements,
  type Measurement,
  type MeasurementKind,
  type QuantityUnit,
  type SheetSummary,
  type TakeoffIssue,
  type TakeoffReport,
  type Trade,
  type TradeScope,
} from "@/lib/tools/material-takeoff";
import { listCorrections, listQuantities, listSheets } from "./client";
import type { EngineCorrection, EngineQuantity, EngineSheet, ReviewAction } from "./types";

type EffectiveDecision = {
  action: ReviewAction;
  corrected_quantity?: number | null;
  corrected_unit?: string | null;
  corrected_description?: string | null;
};

type BridgeOptions = {
  includeHighConfidence?: boolean;
  assemblyOverrides?: Record<string, Record<string, number>>;
  scope?: TradeScope;
};

type BridgeResult = {
  report: TakeoffReport;
  includedQuantityIds: string[];
};

const UNIT_KIND: Record<string, { kind: MeasurementKind; unit: QuantityUnit; factor: number }> = {
  EA: { kind: "count", unit: "EA", factor: 1 },
  LF: { kind: "length", unit: "LF", factor: 1 },
  SF: { kind: "area", unit: "SF", factor: 1 },
  SY: { kind: "area", unit: "SF", factor: 9 },
  CY: { kind: "volume", unit: "CY", factor: 1 },
};

const BAD_SLAB_REASONS = new Set(["no_reliable_scale", "nts_sheet", "multi_thickness"]);

function numberAttr(attrs: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = attrs?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function markCountEntries(attrs: Record<string, unknown> | undefined): [string, number][] {
  const raw = attrs?.mark_counts;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw)
    .flatMap(([mark, count]) => (
      typeof count === "number" && Number.isFinite(count) && count > 0
        ? [[mark, count] as [string, number]]
        : []
    ))
    .sort(([a], [b]) => a.localeCompare(b));
}

function geometrySignature(q: Partial<EngineQuantity> | undefined): string {
  const ids = q?.source_geometry_ids?.filter(Boolean).sort() ?? [];
  if (ids.length > 0) return `geom:${ids.join("|")}`;
  return [
    "fallback",
    q?.sheet_id ?? "",
    q?.item_type ?? "",
    q?.unit ?? "",
    q?.description ?? "",
    typeof q?.quantity === "number" ? q.quantity.toFixed(4) : "",
  ].join("|");
}

function samePhysicalItem(a: Partial<EngineQuantity> | undefined, b: EngineQuantity): boolean {
  if (!a || a.sheet_id !== b.sheet_id) return false;
  const sigA = geometrySignature(a);
  const sigB = geometrySignature(b);
  if (sigA !== sigB) return false;
  if (a.item_type && a.item_type !== b.item_type) return false;
  return true;
}

function correctionTime(correction: EngineCorrection): number {
  const time = correction.created_at ? Date.parse(correction.created_at) : 0;
  return Number.isFinite(time) ? time : 0;
}

function reconcileCorrections(
  quantities: EngineQuantity[],
  corrections: EngineCorrection[],
  issues: TakeoffIssue[],
): Map<string, EffectiveDecision> {
  const decisions = new Map<string, EffectiveDecision>();
  const ordered = [...corrections].sort((a, b) => correctionTime(a) - correctionTime(b));

  for (const correction of ordered) {
    const snapshot = correction.machine_snapshot;
    const candidates = quantities.filter((q) => samePhysicalItem(snapshot, q));

    if (candidates.length === 1) {
      decisions.set(candidates[0].id, correction);
      continue;
    }

    if (candidates.length > 1) {
      issues.push({
        severity: "warning",
        where: snapshot?.sheet_id ?? correction.quantity_item_id,
        message: "A prior review decision matched multiple current quantities; re-review required.",
      });
      continue;
    }

    const byId = quantities.find((q) => q.id === correction.quantity_item_id);
    if (byId && samePhysicalItem(snapshot, byId)) {
      decisions.set(byId.id, correction);
      continue;
    }

    issues.push({
      severity: "warning",
      where: snapshot?.sheet_id ?? correction.quantity_item_id,
      message: "A prior review decision could not be matched to the re-processed geometry.",
    });
  }

  return decisions;
}

function sheetRef(q: EngineQuantity, sheets: Map<string, EngineSheet>): string {
  const sheet = sheets.get(q.sheet_id);
  const number = sheet?.sheet_number || q.sheet_id;
  return `${number} p.${q.page_number}`;
}

function sheetSummaries(sheets: EngineSheet[], quantities: EngineQuantity[]): SheetSummary[] {
  return sheets.map((sheet) => ({
    fileName: "takeoff-engine",
    pageNumber: Number(sheet.page_number ?? 0),
    sheetId: sheet.id,
    sheetTitle: sheet.sheet_title ?? sheet.sheet_number ?? undefined,
    scale: "engine-reviewed",
    measurementCount: quantities.filter((q) => q.sheet_id === sheet.id).length,
  }));
}

function includeQuantity(
  q: EngineQuantity,
  status: string,
  includeHighConfidence: boolean,
): boolean {
  if (status === "accepted" || status === "edited") return true;
  if (status === "rejected") return false;
  return includeHighConfidence && !q.needs_review;
}

function canonicalQuantity(q: EngineQuantity, decision?: EffectiveDecision): {
  quantity: number;
  unit: string;
  description: string;
} {
  return {
    quantity:
      typeof decision?.corrected_quantity === "number"
        ? decision.corrected_quantity
        : Number(q.quantity),
    unit: (decision?.corrected_unit || q.unit || "").toUpperCase(),
    description: decision?.corrected_description || q.description || q.item_type,
  };
}

function mapQuantity(
  q: EngineQuantity,
  sheets: Map<string, EngineSheet>,
  decision: EffectiveDecision | undefined,
  effectiveStatus: string,
  issues: TakeoffIssue[],
): Measurement | null {
  const canonical = canonicalQuantity(q, decision);
  const unitMap = UNIT_KIND[canonical.unit];
  const where = `${sheetRef(q, sheets)} - ${canonical.description}`;
  const reasons = q.review_reason ?? [];
  const attrs = q.attributes ?? {};

  if (!unitMap) {
    issues.push({
      severity: "warning",
      where,
      message: `Unsupported engine unit "${canonical.unit}" passed through as a general warning.`,
    });
    return null;
  }

  let trade: Trade = "general";
  let assemblyId: string | undefined;
  let kind = unitMap.kind;
  let unit = unitMap.unit;
  let quantity = canonical.quantity * unitMap.factor;
  const assumptions = [...reasons];
  const assemblyParams: Record<string, number> = {};

  switch (q.item_type) {
    case "concrete_slab": {
      trade = "concrete";
      if (canonical.unit === "CY") {
        const unresolved =
          effectiveStatus === "pending" &&
          (q.needs_review || reasons.some((reason) => BAD_SLAB_REASONS.has(reason)));
        if (quantity === 0 || unresolved) {
          issues.push({
            severity: "warning",
            where,
            message: "Concrete slab needs scale/thickness review before it can produce material lines.",
          });
          return null;
        }
        assemblyId = "concrete-slab";
        const slabSf = numberAttr(attrs, ["sqft", "base_sqft", "area_sf", "slab_sf"]);
        if (slabSf !== undefined) assemblyParams.slabSf = slabSf;
      } else {
        assemblyId = undefined;
        kind = "area";
        unit = "SF";
        assumptions.push("Concrete slab area has ambiguous thickness; volume not inferred.");
      }
      break;
    }
    case "flooring":
    case "room": {
      trade = "flooring";
      assemblyId = "vct-flooring";
      kind = "area";
      unit = "SF";
      const baseSqft = numberAttr(attrs, ["base_sqft", "sqft"]);
      quantity = baseSqft ?? quantity;
      assumptions.push("VCT assumed - override if carpet, tile, or another finish is specified.");
      break;
    }
    case "door":
    case "window": {
      trade = "doors_windows";
      assemblyId = undefined;
      kind = "count";
      unit = "EA";
      quantity = Math.round(quantity);
      const countBasis = typeof attrs.count_basis === "string" ? attrs.count_basis : "";
      const symbolCount = numberAttr(attrs, ["symbol_count"]);
      const uniqueMarkCount = numberAttr(attrs, ["unique_mark_count"]);
      const unmatchedSymbolCount = numberAttr(attrs, ["unmatched_symbol_count"]);
      if (countBasis === "scheduled_plan_marks") {
        const openingCount = numberAttr(attrs, ["opening_count", "symbol_count"]);
        const scheduleRowCount = numberAttr(attrs, ["schedule_row_count"]);
        if (openingCount !== undefined) {
          assumptions.push([
            `Count basis: ${openingCount} scheduled ${openingCount === 1 ? "opening" : "openings"} shown on scoped plan`,
            scheduleRowCount !== undefined ? `${scheduleRowCount} door schedule rows` : "",
          ].filter(Boolean).join("; "));
        }
        const excluded = Array.isArray(attrs.existing_schedule_marks_excluded)
          ? attrs.existing_schedule_marks_excluded.filter((mark): mark is string => typeof mark === "string")
          : [];
        if (excluded.length > 0) {
          assumptions.push(`Existing/ETR door schedule marks excluded: ${excluded.join(", ")}`);
        }
      } else if (symbolCount !== undefined || uniqueMarkCount !== undefined) {
        const accepted = symbolCount ?? quantity;
        assumptions.push([
          `Count basis: ${accepted} accepted ${accepted === 1 ? "symbol" : "symbols"}`,
          uniqueMarkCount !== undefined ? `${uniqueMarkCount} unique scheduled marks` : "",
        ].filter(Boolean).join("; "));
      }
      if (countBasis !== "scheduled_plan_marks") {
        const duplicateMarks = markCountEntries(attrs)
          .filter(([, count]) => count > 1)
          .map(([mark, count]) => `${mark} x${count}`);
        if (duplicateMarks.length > 0) {
          assumptions.push(`Duplicate scheduled marks represented by multiple symbols/leaves: ${duplicateMarks.join(", ")}`);
        }
        if (unmatchedSymbolCount !== undefined && unmatchedSymbolCount > 0) {
          assumptions.push(
            `${unmatchedSymbolCount} accepted ${unmatchedSymbolCount === 1 ? "symbol" : "symbols"} had no matched schedule mark.`,
          );
        }
      }
      break;
    }
    case "wall": {
      trade = "framing";
      assemblyId = "metal-stud-wall";
      const unitSizeIn = numberAttr(attrs, ["unit_size_in"]);
      if (unitSizeIn !== undefined) {
        assemblyParams.studSizeIn = unitSizeIn;
        assumptions.push(`Wall schedule unit size ${unitSizeIn}"`);
      }
      break;
    }
    case "column":
    case "square_column":
    case "round_column": {
      trade = "concrete";
      assemblyId = undefined;
      kind = "count";
      unit = "EA";
      quantity = Math.round(quantity);
      const shape = typeof attrs.shape === "string" ? attrs.shape : undefined;
      if (shape) assumptions.push(`${shape} column`);
      break;
    }
    case "slab": {
      trade = "concrete";
      assemblyId = canonical.unit === "CY" ? "concrete-slab" : undefined;
      break;
    }
    default: {
      issues.push({
        severity: "warning",
        where,
        message: `No assembly mapping for engine item type "${q.item_type}"; raw quantity included.`,
      });
      break;
    }
  }

  if (!Number.isFinite(quantity) || quantity < 0) {
    issues.push({ severity: "warning", where, message: "Engine quantity was not finite." });
    return null;
  }

  return {
    kind,
    quantity,
    unit,
    trade,
    assemblyId,
    label: canonical.description,
    sheetRef: sheetRef(q, sheets),
    basis: `${q.formula || "engine quantity"} [engine ${q.item_type} ${canonical.unit}, ${effectiveStatus}, conf ${q.final_confidence ?? 0}]`,
    source: effectiveStatus === "edited" ? "schedule" : "traced",
    assumptions,
    assemblyParams: Object.keys(assemblyParams).length ? assemblyParams : undefined,
  };
}

export function buildReportFromEngineData(opts: {
  quantities: EngineQuantity[];
  sheets: EngineSheet[];
  corrections?: EngineCorrection[];
  bridge?: BridgeOptions;
}): BridgeResult {
  const issues: TakeoffIssue[] = [];
  const sheetsById = new Map(opts.sheets.map((sheet) => [sheet.id, sheet]));
  const decisions = reconcileCorrections(opts.quantities, opts.corrections ?? [], issues);
  const measurements: Measurement[] = [];
  const includedQuantityIds: string[] = [];
  const includeHighConfidence = opts.bridge?.includeHighConfidence ?? true;

  for (const quantity of opts.quantities) {
    const decision = decisions.get(quantity.id);
    const effectiveStatus = decision?.action === "accept"
      ? "accepted"
      : decision?.action === "edit"
        ? "edited"
        : decision?.action === "reject"
          ? "rejected"
          : quantity.review_status;

    if (!includeQuantity(quantity, effectiveStatus, includeHighConfidence)) continue;
    const measurement = mapQuantity(quantity, sheetsById, decision, effectiveStatus, issues);
    if (measurement) {
      measurements.push(measurement);
      includedQuantityIds.push(quantity.id);
    }
  }

  return {
    includedQuantityIds,
    report: buildReportFromMeasurements(measurements, {
      sheets: sheetSummaries(opts.sheets, measurements.length ? opts.quantities : []),
      scope: opts.bridge?.scope,
      assemblyOverrides: opts.bridge?.assemblyOverrides,
      issues,
    }),
  };
}

export async function buildBridgedTakeoffReport(
  engineProjectId: string,
  bridge?: BridgeOptions,
): Promise<BridgeResult> {
  const [sheets, quantities, corrections] = await Promise.all([
    listSheets(engineProjectId),
    listQuantities(engineProjectId),
    listCorrections(engineProjectId),
  ]);
  return buildReportFromEngineData({ sheets, quantities, corrections, bridge });
}
