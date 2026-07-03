"use server";

import { requireUser } from "@/lib/auth/server";
import { isGoogleConnected, getValidAccessToken } from "@/lib/google/client";
import { driveListFolder, driveDownloadBinary } from "@/lib/google/drive";
import { sheetsCreate } from "@/lib/google/sheets";
import {
  extractLineItemsLight,
  aggregateLineItems,
  type TakeoffLineItem,
} from "@/lib/tools/invoice-aggregation";
import { recordUsage } from "@/lib/usage";

export type TakeoffState = {
  error?: string;
  sheetLink?: string;
  rows?: { product: string; totalQuantity: number; unit?: string; sourceCount: number }[];
  filesProcessed?: number;
  filesSkipped?: number;
};

const MAX_FILES = 25;
const INVOICE_MIMES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/heic",
]);

function extractFolderId(input: string): string {
  const trimmed = input.trim();
  const m = trimmed.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  const m2 = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return m2[1];
  return trimmed;
}

export async function runTakeoffAction(
  _prev: TakeoffState,
  formData: FormData,
): Promise<TakeoffState> {
  const user = await requireUser();
  if (!(await isGoogleConnected(user.id))) {
    return { error: "Connect Google in Customize → Connections first." };
  }

  const folderInput = String(formData.get("folder") ?? "").trim();
  if (!folderInput) return { error: "Paste a Drive folder link or ID." };
  const folderId = extractFolderId(folderInput);

  try {
    const token = await getValidAccessToken(user.id);
    const files = await driveListFolder(token, folderId, 50);
    const invoiceFiles = files.filter((f) => INVOICE_MIMES.has(f.mimeType));
    const skipped = files.length - invoiceFiles.length;
    if (invoiceFiles.length === 0) {
      return { error: "No PDF/image invoices found in that folder." };
    }
    const capped = invoiceFiles.slice(0, MAX_FILES);

    const allItems: TakeoffLineItem[][] = [];
    for (const f of capped) {
      const bin = await driveDownloadBinary(token, f.id);
      const { items, usage } = await extractLineItemsLight({
        fileBase64: bin.base64,
        mime: bin.mime,
        fileName: f.name,
      });
      await recordUsage({
        userId: user.id,
        model: usage.model,
        feature: "material_takeoff",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
      allItems.push(items);
    }

    const aggregated = aggregateLineItems(allItems);
    const rows: (string | number)[][] = [
      ["Product / Material", "Total Quantity", "Unit", "# Invoices"],
      ...aggregated.map((a) => [a.product, a.totalQuantity, a.unit ?? "", a.sourceCount]),
    ];
    const sheet = await sheetsCreate(token, `Material Takeoff — ${new Date().toLocaleDateString()}`, rows);

    return {
      sheetLink: sheet.link,
      rows: aggregated,
      filesProcessed: capped.length,
      filesSkipped: skipped + Math.max(0, invoiceFiles.length - MAX_FILES),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Takeoff failed." };
  }
}
