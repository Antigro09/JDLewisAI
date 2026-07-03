import { generate, extractJson, type GenerateResult } from "@/lib/claude/chat";

/**
 * Invoice line-item aggregation (the Drive-folder → spreadsheet feature).
 * Moved out of material-takeoff.ts: this reads PURCHASE INVOICES, which is a
 * procurement roll-up — not a construction takeoff. The real takeoff engine
 * (drawings → measurements → assemblies → CSI-organized quantities) lives in
 * lib/tools/material-takeoff.ts.
 */

export type TakeoffLineItem = {
  product: string;
  quantity: number;
  unit?: string;
};

const SYSTEM = `You are an accounts-payable assistant for a general contractor. You read an
invoice (image or PDF) and extract ONLY its line items as product/material name + quantity + unit
of measure — ignore vendor, totals, and dates. Output STRICT JSON only matching this shape:
{ "items": [{"product": string, "quantity": number, "unit": string}] }
Use the product/material name as written on the invoice (e.g. "2x4x8 SPF stud", "1/2\\" drywall
4x8 sheet"). "quantity" must be a plain number (no units, no commas). "unit" is the unit of
measure if shown (e.g. "EA", "LF", "SF", "BOX") — omit it if not stated. Skip lines that aren't
billable materials (e.g. subtotal/tax/freight rows).`;

export async function extractLineItemsLight(opts: {
  fileBase64: string;
  mime: string;
  fileName: string;
  model?: string;
}): Promise<{ items: TakeoffLineItem[]; usage: GenerateResult }> {
  const usage = await generate({
    model: opts.model,
    effort: "medium",
    system: SYSTEM,
    maxTokens: 3000,
    turns: [
      {
        role: "user",
        text: "Extract this invoice's line items. Return JSON only.",
        attachments: [
          { mime: opts.mime, name: opts.fileName, dataBase64: opts.fileBase64 },
        ],
      },
    ],
  });

  const parsed = extractJson<{ items?: TakeoffLineItem[] }>(usage.text);
  const items = Array.isArray(parsed?.items) ? parsed!.items : [];
  return {
    items: items
      .filter((i) => i && i.product && Number.isFinite(Number(i.quantity)))
      .map((i) => ({
        product: String(i.product),
        quantity: Number(i.quantity),
        unit: i.unit ? String(i.unit) : undefined,
      })),
    usage,
  };
}

/** Deterministic normalization for grouping near-duplicate product names —
 * no LLM/embedding call, kept cheap and predictable. */
export function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/["']/g, "")
    .replace(/[.,;:]+$/g, "")
    .replace(/\s+/g, " ");
}

export type AggregatedLineItem = {
  product: string;
  totalQuantity: number;
  unit?: string;
  sourceCount: number;
};

export function aggregateLineItems(
  allItems: TakeoffLineItem[][],
): AggregatedLineItem[] {
  const groups = new Map<string, AggregatedLineItem & { display: string }>();
  for (const items of allItems) {
    for (const item of items) {
      const norm = normalizeProductName(item.product);
      // Keep differing units as separate rows rather than mis-summing.
      const key = `${norm}::${(item.unit ?? "").toLowerCase()}`;
      const existing = groups.get(key);
      if (existing) {
        existing.totalQuantity += item.quantity;
        existing.sourceCount += 1;
      } else {
        groups.set(key, {
          product: item.product,
          display: item.product,
          totalQuantity: item.quantity,
          unit: item.unit,
          sourceCount: 1,
        });
      }
    }
  }
  return Array.from(groups.values())
    .map(({ display, totalQuantity, unit, sourceCount }) => ({
      product: display,
      totalQuantity,
      unit,
      sourceCount,
    }))
    .sort((a, b) => b.totalQuantity - a.totalQuantity);
}
