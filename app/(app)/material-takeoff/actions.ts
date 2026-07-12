"use server";

import { db } from "@/lib/db";
import { takeoffProjects } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";
import { getValidAccessToken, isGoogleConnected } from "@/lib/google/client";
import { sheetsCreate } from "@/lib/google/sheets";
import { buildBridgedTakeoffReport } from "@/lib/takeoff-engine/bridge";
import { createProject } from "@/lib/takeoff-engine/client";
import { requireTakeoff } from "@/lib/takeoff-engine/auth";
import type { TakeoffReport } from "@/lib/tools/material-takeoff";

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

export async function createTakeoffAction(name: string) {
  const user = await requireUser();
  const projectName = name.trim() || "Untitled takeoff";
  const project = await createProject(projectName);
  const [row] = await db
    .insert(takeoffProjects)
    .values({
      userId: user.id,
      engineProjectId: project.id,
      name: projectName,
      status: "created",
    })
    .returning();
  return { takeoff: row };
}

export async function exportTakeoffToGoogleSheetAction(takeoffId: string): Promise<{ link?: string; error?: string }> {
  const { user, row } = await requireTakeoff(takeoffId);
  if (!(await isGoogleConnected(user.id))) {
    return { error: "Google account is not connected." };
  }
  const result = await buildBridgedTakeoffReport(row.engineProjectId, { includeHighConfidence: true });
  const token = await getValidAccessToken(user.id);
  const sheet = await sheetsCreate(
    token,
    `Material Takeoff - ${new Date().toLocaleDateString()}`,
    rowsFromReport(result.report),
  );
  return { link: sheet.link };
}
