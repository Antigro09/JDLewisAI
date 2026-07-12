import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { takeoffProjects, type TakeoffProject, type TakeoffStatus } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { effectivePlugins } from "@/lib/plugins";
import type { Attachment } from "@/lib/claude/types";
import type { Tool, ToolContext, ToolInput, ToolResult } from "@/lib/tools/registry";
import {
  createProject,
  EngineDownError,
  EngineHttpError,
  EngineTimeoutError,
  getJob,
  indexProject,
  listSheets,
  startScopedProcess,
  uploadFile,
} from "@/lib/takeoff-engine/client";
import { parseTakeoffScope } from "@/lib/takeoff-engine/scope-parser";
import { buildBridgedTakeoffReport } from "@/lib/takeoff-engine/bridge";
import type { TakeoffReport } from "@/lib/tools/material-takeoff";

/**
 * Material Takeoff chat tools. Design invariant (non-negotiable): every number
 * a user sees comes from the deterministic takeoff engine — the model never
 * fabricates or infers a count/measurement. `material_takeoff` returns NO
 * quantities (only a job handle + review link); quantities are only ever read
 * back through `get_takeoff_results`, which sources them from the engine bridge.
 *
 * Flow (start & hand off): create project → upload the attached drawings →
 * index → (bounded wait for indexing) → start the scoped process → hand off a
 * deep link to the existing review UI. The job finishes asynchronously and goes
 * through the human review queue; the tool never blocks the chat turn to
 * completion. Re-invoking resumes an in-progress takeoff.
 */

/** Total time the tool will spend advancing the pipeline before handing off.
 * Kept short so the chat turn stays responsive; slow indexing hands off early
 * and resumes on the next call. */
const ADVANCE_BUDGET_MS = 40_000;
const POLL_MS = 2_000;
const TAKEOFF_MIME = new Set(["application/pdf", "image/tiff", "image/tif"]);

function isTakeoffFile(a: Attachment): boolean {
  const mime = a.mime.toLowerCase();
  const name = a.name.toLowerCase();
  return (
    TAKEOFF_MIME.has(mime) ||
    name.endsWith(".pdf") ||
    name.endsWith(".tif") ||
    name.endsWith(".tiff")
  );
}

export function hasPdfOrTiff(attachments?: Attachment[]): boolean {
  return Boolean(attachments?.some(isTakeoffFile));
}

/** In prod TAKEOFF_ENGINE_URL is required; in dev the client falls back to
 * localhost, so treat the engine as configured. */
export function isTakeoffConfigured(): boolean {
  return Boolean(env.TAKEOFF_ENGINE_URL) || process.env.NODE_ENV !== "production";
}

async function takeoffPluginOn(userId: string): Promise<boolean> {
  try {
    const plugins = await effectivePlugins(userId);
    return plugins.material_takeoff ?? true;
  } catch {
    return true;
  }
}

async function latestLinkedTakeoff(
  userId: string,
  conversationId: string,
): Promise<TakeoffProject | null> {
  const rows = await db
    .select()
    .from(takeoffProjects)
    .where(
      and(
        eq(takeoffProjects.userId, userId),
        eq(takeoffProjects.conversationId, conversationId),
      ),
    )
    .orderBy(desc(takeoffProjects.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function conversationHasLinkedTakeoff(ctx: ToolContext): Promise<boolean> {
  return Boolean(await latestLinkedTakeoff(ctx.userId, ctx.conversationId));
}

function attachmentToFile(a: Attachment): File {
  const bytes = Buffer.from(a.dataBase64, "base64");
  return new File([bytes], a.name || "drawing.pdf", {
    type: a.mime || "application/pdf",
  });
}

function reviewLink(takeoffId: string): string {
  return `/material-takeoff?t=${takeoffId}`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

function engineErrorResult(err: unknown, tool: string): ToolResult {
  if (err instanceof EngineDownError || err instanceof EngineTimeoutError) {
    return {
      output: JSON.stringify({
        error: "engine_unavailable",
        note: "The takeoff engine is unavailable right now. Tell the user it could not be reached and to try again later. Do NOT estimate or guess any quantities.",
      }),
      summary: "Takeoff engine unavailable",
      status: "error",
      isError: true,
    };
  }
  if (err instanceof EngineHttpError) {
    return {
      output: JSON.stringify({
        error: "engine_error",
        status: err.status,
        note: "The takeoff engine returned an error. Do NOT estimate or guess any quantities.",
      }),
      summary: `Takeoff engine error (HTTP ${err.status})`,
      status: "error",
      isError: true,
    };
  }
  return {
    output: `Error running ${tool}: ${err instanceof Error ? err.message : "unknown"}`,
    summary: `${tool} failed`,
    status: "error",
    isError: true,
  };
}

async function setRow(id: string, patch: Partial<TakeoffProject>): Promise<void> {
  await db
    .update(takeoffProjects)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(takeoffProjects.id, id));
}

function tradeSummary(scopeText: string, requests: { trade: string }[]): string {
  if (scopeText) return scopeText;
  const trades = [...new Set(requests.map((r) => r.trade))];
  return trades.length ? trades.join(", ") : "all trades";
}

function handOff(
  row: TakeoffProject,
  status: TakeoffStatus,
  scopeSummary: string,
  sheetCount: number,
): ToolResult {
  const link = reviewLink(row.id);
  const stageNote: Record<string, string> = {
    processing:
      "The takeoff is running. Do NOT state any counts or measurements yet — quantities come only from get_takeoff_results once the job finishes and passes human review.",
    indexing:
      "The drawings are still being indexed. Hand the user the review link; they can start/finish the scoped takeoff there, or ask again shortly. Do NOT state any quantities.",
    uploading:
      "Drawings uploaded; indexing will begin. Do NOT state any quantities.",
    review:
      "Measurement is complete and awaiting review — call get_takeoff_results for engine totals. Do NOT invent quantities.",
    failed: "The takeoff failed. Tell the user; do NOT estimate quantities.",
  };
  return {
    output: JSON.stringify({
      takeoffId: row.id,
      status,
      sheets: sheetCount,
      scope: scopeSummary,
      note: stageNote[status] ?? "Do NOT state any quantities that did not come from a tool result.",
    }),
    summary:
      status === "processing"
        ? `Started material takeoff (${scopeSummary})${sheetCount ? ` — ${sheetCount} sheet(s) processing` : ""}`
        : `Material takeoff ${status} (${scopeSummary})`,
    status: status === "failed" ? "error" : "in_progress",
    isError: status === "failed",
    link,
    artifacts: [{ kind: "link", label: "Open review queue", url: link }],
  };
}

async function materialTakeoffRun(ctx: ToolContext, input: ToolInput): Promise<ToolResult> {
  const scopeText = typeof input.scope === "string" ? input.scope.trim() : "";
  const attachment = ctx.attachments?.find(isTakeoffFile);
  const projectName =
    (typeof input.projectName === "string" && input.projectName.trim()) ||
    (scopeText ? `Takeoff — ${scopeText}`.slice(0, 80) : "Chat takeoff");

  try {
    let row = await latestLinkedTakeoff(ctx.userId, ctx.conversationId);

    // A new drawing set starts a fresh takeoff; a bare "created" row (no upload
    // yet) is reused. Follow-ups without an attachment resume the latest row.
    const startFresh = attachment && (!row || row.status !== "created");
    if (startFresh) {
      ctx.onProgress?.("Creating takeoff project…");
      const project = await createProject(projectName);
      const inserted = await db
        .insert(takeoffProjects)
        .values({
          userId: ctx.userId,
          engineProjectId: project.id,
          name: projectName,
          status: "created",
          conversationId: ctx.conversationId,
        })
        .returning();
      row = inserted[0];
    }

    if (!row) {
      return {
        output: JSON.stringify({
          error: "no_drawings",
          note: "There is no takeoff for this conversation and no drawing attached. Ask the user to attach a PDF or TIFF drawing set.",
        }),
        summary: "No drawings to take off",
        status: "error",
        isError: true,
      };
    }

    let sheetCount = 0;
    const deadline = Date.now() + ADVANCE_BUDGET_MS;

    // Advance the pipeline as far as the time budget allows, streaming progress.
    // Each iteration reads the local row's status and takes the next step.
    while (Date.now() < deadline && !ctx.signal?.aborted) {
      switch (row.status) {
        case "created": {
          if (!attachment) {
            return {
              output: JSON.stringify({
                error: "no_drawings",
                note: "Ask the user to attach a PDF or TIFF drawing set to run the takeoff.",
              }),
              summary: "No drawings attached",
              status: "error",
              isError: true,
            };
          }
          ctx.onProgress?.(`Uploading ${attachment.name}…`);
          await uploadFile(row.engineProjectId, attachmentToFile(attachment));
          await setRow(row.id, { status: "uploading" });
          row = { ...row, status: "uploading" };
          break;
        }
        case "uploading": {
          ctx.onProgress?.("Indexing drawings…");
          const job = await indexProject(row.engineProjectId);
          await setRow(row.id, {
            status: "indexing",
            engineJobId: job.job_id,
            jobStatus: job.status,
            processStartedAt: new Date(),
          });
          row = { ...row, status: "indexing", engineJobId: job.job_id };
          break;
        }
        case "indexing": {
          if (!row.engineJobId) {
            // No index job recorded — restart indexing.
            row = { ...row, status: "uploading" };
            break;
          }
          const job = await getJob(row.engineJobId);
          if (job.status === "done") {
            await setRow(row.id, { status: "indexed", jobStatus: "done" });
            row = { ...row, status: "indexed" };
            break;
          }
          if (job.status === "failed") {
            await setRow(row.id, { status: "failed", jobStatus: "failed", jobError: job.error ?? "" });
            return handOff(row, "failed", tradeSummary(scopeText, []), sheetCount);
          }
          ctx.onProgress?.(job.progress ? `Indexing: ${job.progress}` : "Indexing drawings…");
          await sleep(POLL_MS, ctx.signal);
          break;
        }
        case "indexed": {
          const sheets = await listSheets(row.engineProjectId).catch(() => []);
          sheetCount = sheets.length;
          const scope = parseTakeoffScope(
            scopeText || "walls, doors, flooring, columns",
            sheets,
          );
          ctx.onProgress?.("Starting measurement…");
          const job = await startScopedProcess(row.engineProjectId, scope);
          await setRow(row.id, {
            status: "processing",
            engineJobId: job.job_id,
            jobStatus: job.status,
            takeoffInstructions: scopeText,
            takeoffScope: scope,
            processStartedAt: new Date(),
          });
          row = { ...row, status: "processing" };
          return handOff(row, "processing", tradeSummary(scopeText, scope.requests), sheetCount);
        }
        case "processing":
        case "review":
        case "failed":
          return handOff(row, row.status, tradeSummary(scopeText, []), sheetCount);
        default:
          return handOff(row, row.status, tradeSummary(scopeText, []), sheetCount);
      }
    }

    // Budget/abort reached mid-pipeline — hand off at the current stage.
    return handOff(row, row.status, tradeSummary(scopeText, []), sheetCount);
  } catch (err) {
    return engineErrorResult(err, "material_takeoff");
  }
}

/** Aggregate engine measurements into per-trade, per-unit totals. Numbers are
 * the engine's — this only groups them. */
function summarizeTotals(
  report: TakeoffReport,
  tradeFilter: string,
): { byTrade: Record<string, Record<string, number>>; itemCount: number } {
  const filter = tradeFilter.trim().toLowerCase();
  const byTrade: Record<string, Record<string, number>> = {};
  let itemCount = 0;
  for (const m of report.measurements) {
    if (
      filter &&
      !m.trade.toLowerCase().includes(filter) &&
      !m.label.toLowerCase().includes(filter)
    ) {
      continue;
    }
    itemCount += 1;
    (byTrade[m.trade] ??= {});
    byTrade[m.trade][m.unit] = Math.round(((byTrade[m.trade][m.unit] ?? 0) + m.quantity) * 100) / 100;
  }
  return { byTrade, itemCount };
}

async function getTakeoffResultsRun(ctx: ToolContext, input: ToolInput): Promise<ToolResult> {
  const row = await latestLinkedTakeoff(ctx.userId, ctx.conversationId);
  if (!row) {
    return {
      output: JSON.stringify({
        error: "no_takeoff",
        note: "No takeoff is linked to this conversation yet. Ask the user to attach drawings and start one with material_takeoff.",
      }),
      summary: "No takeoff linked",
      status: "error",
      isError: true,
    };
  }
  const link = reviewLink(row.id);
  const trade = typeof input.trade === "string" ? input.trade : "";

  try {
    // Refresh job status when a job is in flight.
    let jobDone = false;
    if (row.engineJobId) {
      const job = await getJob(row.engineJobId).catch(() => null);
      if (job) jobDone = job.status === "done";
    }

    // Quantities are only real once the engine has produced them (processing
    // finished, or already in review). Anything earlier: report status, no
    // numbers.
    const producedResults =
      row.status === "review" || (row.status === "processing" && jobDone);
    if (!producedResults) {
      if (row.status === "failed") {
        return {
          output: JSON.stringify({
            takeoffId: row.id,
            status: "failed",
            error: row.jobError || "unknown",
            note: "The takeoff failed. Tell the user; do NOT estimate quantities.",
          }),
          summary: "Takeoff failed",
          status: "error",
          isError: true,
          link,
        };
      }
      return {
        output: JSON.stringify({
          takeoffId: row.id,
          status: row.status,
          note: "The takeoff has not produced quantities yet. Report the status only; do NOT state any counts or measurements.",
        }),
        summary: `Takeoff ${row.status}`,
        status: "in_progress",
        link,
      };
    }

    const { report } = await buildBridgedTakeoffReport(row.engineProjectId, {
      includeHighConfidence: true,
    });
    const totals = summarizeTotals(report, trade);
    return {
      output: JSON.stringify({
        takeoffId: row.id,
        status: "review",
        totals: totals.byTrade,
        itemCount: totals.itemCount,
        note: "The totals above are produced by the takeoff engine and are pending human review. State only these numbers; do NOT add, infer, or round to different quantities.",
      }),
      summary: `Takeoff totals ready (${totals.itemCount} item${totals.itemCount === 1 ? "" : "s"})`,
      status: "needs_review",
      link,
      artifacts: [{ kind: "report", label: "Takeoff report", url: link, data: report }],
    };
  } catch (err) {
    return engineErrorResult(err, "get_takeoff_results");
  }
}

const TAKEOFF_DESCRIPTION =
  "Start an automated material takeoff from an attached construction drawing set " +
  "(PDF or TIFF). The takeoff engine detects and measures walls, doors, flooring, " +
  "and columns and produces CSI-organized quantities. Use when the user attaches " +
  "drawings and asks to 'do a takeoff', 'count the doors', 'measure the walls', " +
  "'estimate quantities', or 'how many X are on these plans'. This STARTS a " +
  "background job and returns a review link — it does NOT return quantities " +
  "itself. Call get_takeoff_results afterward for engine-produced counts. Never " +
  "state a count or measurement that did not come from a tool result.";

export const materialTakeoffTool: Tool = {
  descriptor: {
    id: "material_takeoff",
    title: "Material Takeoff",
    description: TAKEOFF_DESCRIPTION,
    // Increment 1: read → auto-run (non-blocking). Increment 2 promotes to
    // write so the paid/slow engine job is confirmed first.
    kind: "read",
    permissions: ["expensive", "cloud"],
    capabilities: ["material_takeoff", "quantity_estimation", "symbol_counting"],
    intentKeywords: [
      "takeoff",
      "material takeoff",
      "count doors",
      "how many",
      "measure",
      "quantities",
      "linear feet",
      "square feet",
      "estimate quantities",
      "framing takeoff",
      "drywall",
    ],
    supportedFileTypes: ["application/pdf", "image/tiff"],
    requiredInputs: [],
    optionalInputs: ["scope", "projectName"],
    fenceOutput: false,
    isAvailable: async (ctx) =>
      isTakeoffConfigured() &&
      (await takeoffPluginOn(ctx.userId)) &&
      (hasPdfOrTiff(ctx.attachments) || (await conversationHasLinkedTakeoff(ctx))),
  },
  definition: {
    name: "material_takeoff",
    description: TAKEOFF_DESCRIPTION,
    input_schema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description:
            "Natural-language scope, e.g. 'doors and walls, west wing only, exclude existing'. Omit for a full takeoff of all trades.",
        },
        projectName: { type: "string", description: "Optional name for the takeoff." },
      },
      required: [],
    },
  },
  describe: (i) =>
    `Start a material takeoff${typeof i.scope === "string" && i.scope ? ` (${i.scope})` : ""} from the attached drawings`,
  run: materialTakeoffRun,
};

const RESULTS_DESCRIPTION =
  "Return the current status and engine-produced quantities for the material " +
  "takeoff linked to this conversation. Use to answer 'how many doors?', 'what's " +
  "the wall linear footage?', or 'is the takeoff done?'. Returns ONLY numbers " +
  "produced by the takeoff engine — never estimate or infer counts yourself. If " +
  "the job is still processing or in review, say so and give no quantities.";

export const getTakeoffResultsTool: Tool = {
  descriptor: {
    id: "get_takeoff_results",
    title: "Takeoff Results",
    description: RESULTS_DESCRIPTION,
    kind: "read",
    permissions: ["cloud"],
    capabilities: ["quantity_readout", "material_takeoff"],
    intentKeywords: [
      "how many",
      "result",
      "quantities",
      "door count",
      "wall length",
      "status",
      "is it done",
      "totals",
    ],
    supportedFileTypes: [],
    requiredInputs: [],
    optionalInputs: ["trade"],
    dependencies: ["material_takeoff"],
    fenceOutput: false,
    isAvailable: async (ctx) =>
      isTakeoffConfigured() &&
      (await takeoffPluginOn(ctx.userId)) &&
      (await conversationHasLinkedTakeoff(ctx)),
  },
  definition: {
    name: "get_takeoff_results",
    description: RESULTS_DESCRIPTION,
    input_schema: {
      type: "object",
      properties: {
        trade: {
          type: "string",
          description: "Optional filter, e.g. 'doors', 'walls', 'flooring', 'columns'.",
        },
      },
      required: [],
    },
  },
  run: getTakeoffResultsRun,
};
