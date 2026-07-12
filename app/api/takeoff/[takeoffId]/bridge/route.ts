import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken, isGoogleConnected } from "@/lib/google/client";
import { sheetsCreate } from "@/lib/google/sheets";
import { recordUsage } from "@/lib/usage";
import { buildBridgedTakeoffReport } from "@/lib/takeoff-engine/bridge";
import { requireTakeoff, takeoffErrorResponse } from "@/lib/takeoff-engine/auth";
import type { TakeoffReport } from "@/lib/tools/material-takeoff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rowsFromReport(report: TakeoffReport): (string | number)[][] {
  const rows: (string | number)[][] = [
    ["Division", "Trade", "Material", "Qty (purchase)", "Unit", "Waste %", "Basis"],
  ];
  for (const div of report.divisions) {
    for (const trade of div.trades) {
      for (const line of trade.materials) {
        rows.push([
          `${div.division} - ${div.divisionTitle}`,
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
  return rows;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ takeoffId: string }> },
) {
  try {
    const { takeoffId } = await params;
    const { user, row } = await requireTakeoff(takeoffId);
    const body = await req.json().catch(() => ({}));
    const result = await buildBridgedTakeoffReport(row.engineProjectId, {
      includeHighConfidence: body.includeHighConfidence !== false,
      assemblyOverrides:
        body.assemblyOverrides && typeof body.assemblyOverrides === "object"
          ? (body.assemblyOverrides as Record<string, Record<string, number>>)
          : undefined,
    });

    await recordUsage({
      userId: user.id,
      model: "takeoff-engine",
      feature: "material_takeoff",
      inputTokens: 0,
      outputTokens: 0,
    });

    let sheetLink: string | undefined;
    if (body.exportSheet === true && (await isGoogleConnected(user.id))) {
      const token = await getValidAccessToken(user.id);
      const sheet = await sheetsCreate(
        token,
        `Material Takeoff - ${new Date().toLocaleDateString()}`,
        rowsFromReport(result.report),
      );
      sheetLink = sheet.link;
    }

    return NextResponse.json({ ...result, sheetLink });
  } catch (err) {
    return takeoffErrorResponse(err);
  }
}
