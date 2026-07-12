import { NextRequest, NextResponse } from "next/server";
import { generateStructured } from "@/lib/claude/chat";
import { listSheets } from "@/lib/takeoff-engine/client";
import { requireTakeoff, takeoffErrorResponse } from "@/lib/takeoff-engine/auth";
import { normalizeTakeoffScope, parseTakeoffScope } from "@/lib/takeoff-engine/scope-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCOPE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["requests"],
  properties: {
    requests: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["trade", "sheet_refs", "include_existing"],
        properties: {
          trade: { type: "string", enum: ["walls", "doors", "flooring", "columns"] },
          sheet_refs: { type: "array", items: { type: "string" } },
          include_existing: { type: "boolean" },
        },
      },
    },
  },
};

async function parseWithLlm(instructions: string, sheets: Awaited<ReturnType<typeof listSheets>>) {
  if (!process.env.ANTHROPIC_API_KEY || !instructions.trim()) return null;
  try {
    const { data } = await generateStructured({
      effort: "medium",
      maxTokens: 1200,
      schema: SCOPE_SCHEMA,
      schemaName: "takeoff_scope",
      system:
        "Parse construction takeoff scoping instructions. Return only requested trades and sheet references. " +
        "Supported trades are walls, doors, flooring, and columns. Default include_existing to false unless the user explicitly asks to include existing work.",
      turns: [
        {
          role: "user",
          text: JSON.stringify({
            instructions,
            available_sheets: sheets.map((sheet) => ({
              id: sheet.id,
              sheet_number: sheet.sheet_number,
              page_number: sheet.page_number,
              sheet_type: sheet.sheet_type,
            })),
          }),
        },
      ],
    });
    return normalizeTakeoffScope(instructions, data, sheets);
  } catch (err) {
    console.warn("scope parse LLM failed; using deterministic parser", err);
    return null;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ takeoffId: string }> },
) {
  try {
    const { takeoffId } = await params;
    const { row } = await requireTakeoff(takeoffId);
    const body = await req.json().catch(() => ({}));
    const instructions = typeof body.instructions === "string" ? body.instructions : "";
    const sheets = await listSheets(row.engineProjectId).catch(() => []);
    const llmScope = await parseWithLlm(instructions, sheets);
    const scope = llmScope?.requests.length ? llmScope : parseTakeoffScope(instructions, sheets);
    return NextResponse.json({ scope });
  } catch (err) {
    return takeoffErrorResponse(err);
  }
}
