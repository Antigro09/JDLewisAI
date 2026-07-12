import type { EngineQuantity } from "@/lib/takeoff-engine/types";

function numberAttr(attrs: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = attrs?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function plural(value: number, singular: string, pluralText = `${singular}s`): string {
  return `${value.toLocaleString()} ${value === 1 ? singular : pluralText}`;
}

export function quantityAuditNote(q: EngineQuantity): string | null {
  const attrs = q.attributes ?? {};
  if (q.item_type === "door" || q.item_type === "window") {
    if (attrs.count_basis === "scheduled_plan_marks") {
      const openings = numberAttr(attrs, "opening_count") ?? numberAttr(attrs, "symbol_count");
      const scheduleRows = numberAttr(attrs, "schedule_row_count");
      const excluded = Array.isArray(attrs.existing_schedule_marks_excluded)
        ? attrs.existing_schedule_marks_excluded.filter((mark): mark is string => typeof mark === "string")
        : [];
      const parts = [
        openings !== undefined ? plural(openings, "scheduled opening") : null,
        scheduleRows !== undefined ? plural(scheduleRows, "schedule row") : null,
        excluded.length > 0 ? `ETR excluded: ${excluded.join(", ")}` : null,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(" / ") : null;
    }
    const symbols = numberAttr(attrs, "symbol_count");
    const marks = numberAttr(attrs, "unique_mark_count");
    const unmatched = numberAttr(attrs, "unmatched_symbol_count");
    if (symbols !== undefined || marks !== undefined) {
      const parts = [
        symbols !== undefined ? plural(symbols, "symbol") : null,
        marks !== undefined ? plural(marks, "scheduled mark") : null,
        unmatched !== undefined && unmatched > 0 ? plural(unmatched, "unmatched symbol") : null,
      ].filter(Boolean);
      return parts.join(" / ");
    }
  }
  if (q.item_type === "wall") {
    const segments = numberAttr(attrs, "segment_count");
    if (segments !== undefined) return plural(segments, "wall segment");
  }
  if (q.item_type === "flooring") {
    const baseSqft = numberAttr(attrs, "base_sqft");
    const labels = numberAttr(attrs, "label_area_count");
    if (baseSqft !== undefined && labels !== undefined) {
      return `${baseSqft.toLocaleString()} base SF from ${plural(labels, "room label")}`;
    }
    if (baseSqft !== undefined) return `${baseSqft.toLocaleString()} base SF before waste`;
  }
  return null;
}
