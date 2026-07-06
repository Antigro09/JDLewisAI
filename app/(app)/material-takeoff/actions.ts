"use server";

import { requireUser } from "@/lib/auth/server";
import { isGoogleConnected, getValidAccessToken } from "@/lib/google/client";
import { sheetsCreate } from "@/lib/google/sheets";
import {
  runMaterialTakeoff,
  TRADES,
  type TakeoffFile,
  type TakeoffReport,
  type Trade,
} from "@/lib/tools/material-takeoff";
import { recordUsage } from "@/lib/usage";

export type PlanTakeoffState = {
  error?: string;
  report?: TakeoffReport;
  sheetLink?: string;
};

// Server actions accept 44mb bodies (next.config.mjs); leave headroom for
// multipart overhead.
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const MAX_FILES = 5;
const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export async function runPlanTakeoffAction(
  _prev: PlanTakeoffState,
  formData: FormData,
): Promise<PlanTakeoffState> {
  const user = await requireUser();

  const uploads = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (uploads.length === 0) {
    return { error: "Choose at least one plan sheet (PDF or image)." };
  }
  if (uploads.length > MAX_FILES) {
    return { error: `Upload at most ${MAX_FILES} documents per run.` };
  }
  const totalBytes = uploads.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return { error: "Uploads exceed the 40 MB total limit — split into smaller runs." };
  }
  const bad = uploads.find((f) => !ALLOWED_MIMES.has(f.type));
  if (bad) {
    return { error: `"${bad.name}" is not a PDF/PNG/JPEG/WebP.` };
  }

  const selected = formData
    .getAll("trades")
    .map(String)
    .filter((t): t is Trade => (TRADES as readonly string[]).includes(t));
  const scope = selected.length > 0 ? { trades: selected } : undefined;

  try {
    const files: TakeoffFile[] = await Promise.all(
      uploads.map(async (f) => ({
        fileBase64: Buffer.from(await f.arrayBuffer()).toString("base64"),
        mime: f.type,
        fileName: f.name,
      })),
    );

    const report = await runMaterialTakeoff({ files, scope });
    for (const u of report.usage) {
      await recordUsage({
        userId: user.id,
        model: u.model,
        feature: "material_takeoff",
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
      });
    }

    let sheetLink: string | undefined;
    if (formData.get("exportSheet") === "on" && (await isGoogleConnected(user.id))) {
      const rows: (string | number)[][] = [
        ["Division", "Trade", "Material", "Qty (purchase)", "Unit", "Waste %", "Basis"],
      ];
      for (const div of report.divisions) {
        for (const trade of div.trades) {
          for (const line of trade.materials) {
            rows.push([
              `${div.division} — ${div.divisionTitle}`,
              trade.trade,
              line.description,
              line.quantityPurchase,
              line.unit,
              line.wastePct,
              line.basis,
            ]);
          }
        }
      }
      const token = await getValidAccessToken(user.id);
      const sheet = await sheetsCreate(
        token,
        `Material Takeoff — ${new Date().toLocaleDateString()}`,
        rows,
      );
      sheetLink = sheet.link;
    }

    return { report, sheetLink };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Takeoff failed." };
  }
}
