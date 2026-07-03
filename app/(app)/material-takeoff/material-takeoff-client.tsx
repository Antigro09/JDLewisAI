"use client";

import { useActionState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, Label } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { runPlanTakeoffAction, type PlanTakeoffState } from "./actions";
import type { MaterialLine, TakeoffIssue } from "@/lib/tools/material-takeoff";

const TRADE_LABELS: Record<string, string> = {
  concrete: "Concrete",
  masonry: "Masonry",
  framing: "Framing",
  drywall: "Drywall",
  insulation: "Insulation",
  paint: "Paint",
  flooring: "Flooring",
  doors_windows: "Doors & Windows",
  plumbing: "Plumbing",
  hvac: "HVAC",
  electrical: "Electrical",
  fire_protection: "Fire Protection",
  earthwork: "Earthwork",
  general: "General",
};

function tradeLabel(trade: string): string {
  return TRADE_LABELS[trade] ?? trade;
}

function IssueRow({ issue }: { issue: TakeoffIssue }) {
  const cls =
    issue.severity === "error"
      ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
      : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  return (
    <li className={`rounded-lg px-3 py-2 text-sm ${cls}`}>
      <span className="font-medium">{issue.where}:</span> {issue.message}
    </li>
  );
}

function MaterialRows({ line }: { line: MaterialLine }) {
  return (
    <tr className="border-b border-neutral-100 align-top dark:border-neutral-800">
      <td className="py-1.5 pr-2 dark:text-neutral-200">
        {line.description}
        <div className="mt-0.5 text-xs text-neutral-400">
          {line.basis}
          {line.assumptions.length > 0 && (
            <span> · Assumes: {line.assumptions.join("; ")}</span>
          )}
        </div>
      </td>
      <td className="py-1.5 pr-2 text-right font-medium tabular-nums dark:text-neutral-200">
        {line.quantityPurchase.toLocaleString()}
      </td>
      <td className="py-1.5 pr-2 text-neutral-500 dark:text-neutral-400">{line.unit}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
        {line.quantityExact.toLocaleString()}
      </td>
      <td className="py-1.5 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
        {line.wastePct}%
      </td>
    </tr>
  );
}

export function MaterialTakeoffClient({
  trades,
  googleConnected,
}: {
  trades: readonly string[];
  googleConnected: boolean;
}) {
  const [state, action] = useActionState<PlanTakeoffState, FormData>(
    runPlanTakeoffAction,
    {},
  );
  const report = state.report;

  return (
    <PageShell
      title="Material Takeoff"
      description="Upload plan sheets (PDF or images). The engine reads each sheet, measures counts, lengths, areas, and volumes, runs assembly formulas, and rolls up material quantities by CSI division and trade."
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-fit p-5">
          <form action={action} className="space-y-4">
            <div>
              <Label htmlFor="files">Plan documents</Label>
              <input
                id="files"
                name="files"
                type="file"
                multiple
                required
                accept="application/pdf,image/png,image/jpeg,image/webp"
                className="mt-1 block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100 dark:text-neutral-300 dark:file:bg-brand-950 dark:file:text-brand-300"
              />
              <p className="mt-1 text-xs text-neutral-400">
                Up to 5 files, 10 MB total. Sheets without a printed scale still work from
                dimension strings and schedules.
              </p>
            </div>

            <div>
              <Label>Trade scope</Label>
              <p className="mb-2 text-xs text-neutral-400">
                Leave all unchecked to take off every trade.
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {trades.map((t) => (
                  <label
                    key={t}
                    className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300"
                  >
                    <input type="checkbox" name="trades" value={t} className="accent-brand-600" />
                    {tradeLabel(t)}
                  </label>
                ))}
              </div>
            </div>

            <label
              className={`flex items-center gap-2 text-sm ${
                googleConnected
                  ? "text-neutral-700 dark:text-neutral-300"
                  : "text-neutral-400"
              }`}
            >
              <input
                type="checkbox"
                name="exportSheet"
                disabled={!googleConnected}
                className="accent-brand-600"
              />
              Export quantities to a Google Sheet
              {!googleConnected && (
                <span className="text-xs">(connect Google in Customize → Connections)</span>
              )}
            </label>

            <SubmitButton pendingText="Reading plans…">Run takeoff</SubmitButton>
            {state.error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                {state.error}
              </p>
            )}
          </form>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          {!report && (
            <Card className="p-5">
              <p className="text-sm text-neutral-400">
                Upload plan sheets and run the takeoff to see quantities organized by CSI
                division here — with the measurement basis and assumptions behind every line.
              </p>
            </Card>
          )}

          {report && (
            <>
              {state.sheetLink && (
                <a
                  href={state.sheetLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block rounded-lg bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100 dark:bg-brand-950 dark:text-brand-300"
                >
                  Open the exported Sheet →
                </a>
              )}

              <Card className="p-5">
                <h3 className="mb-3 font-semibold dark:text-neutral-100">Sheets read</h3>
                {report.sheets.length === 0 ? (
                  <p className="text-sm text-neutral-400">
                    No takeoff-relevant sheets were found in the uploaded documents.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-400 dark:border-neutral-800">
                          <th className="py-1 pr-2">File</th>
                          <th className="py-1 pr-2">Page</th>
                          <th className="py-1 pr-2">Sheet</th>
                          <th className="py-1 pr-2">Scale</th>
                          <th className="py-1 text-right">Measurements</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.sheets.map((s, i) => (
                          <tr key={i} className="border-b border-neutral-100 dark:border-neutral-800">
                            <td className="py-1 pr-2 dark:text-neutral-200">{s.fileName}</td>
                            <td className="py-1 pr-2 text-neutral-500 dark:text-neutral-400">
                              {s.pageNumber}
                            </td>
                            <td className="py-1 pr-2 text-neutral-500 dark:text-neutral-400">
                              {[s.sheetId, s.sheetTitle].filter(Boolean).join(" — ") || "—"}
                            </td>
                            <td className="py-1 pr-2 text-neutral-500 dark:text-neutral-400">
                              {s.scale}
                            </td>
                            <td className="py-1 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                              {s.measurementCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              {report.divisions.length === 0 ? (
                <Card className="p-5">
                  <p className="text-sm text-neutral-400">
                    No material quantities could be produced — check the issues below for what
                    the engine couldn&apos;t read.
                  </p>
                </Card>
              ) : (
                report.divisions.map((div) => (
                  <Card key={div.division} className="p-5">
                    <h3 className="mb-3 font-semibold dark:text-neutral-100">
                      Division {div.division} — {div.divisionTitle}
                    </h3>
                    <div className="space-y-4">
                      {div.trades.map((section) => (
                        <div key={section.trade}>
                          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                            {tradeLabel(section.trade)}
                          </h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-400 dark:border-neutral-800">
                                  <th className="py-1 pr-2">Material</th>
                                  <th className="py-1 pr-2 text-right">Buy Qty</th>
                                  <th className="py-1 pr-2">Unit</th>
                                  <th className="py-1 pr-2 text-right">Exact</th>
                                  <th className="py-1 text-right">Waste</th>
                                </tr>
                              </thead>
                              <tbody>
                                {section.materials.map((line, i) => (
                                  <MaterialRows key={i} line={line} />
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))
              )}

              {report.issues.length > 0 && (
                <Card className="p-5">
                  <h3 className="mb-3 font-semibold dark:text-neutral-100">
                    Issues &amp; review items ({report.issues.length})
                  </h3>
                  <ul className="space-y-2">
                    {report.issues.map((issue, i) => (
                      <IssueRow key={i} issue={issue} />
                    ))}
                  </ul>
                </Card>
              )}

              <p className="text-xs text-neutral-400">
                Quantities only — pricing is intentionally separate. {report.measurements.length}{" "}
                measurement{report.measurements.length === 1 ? "" : "s"} across{" "}
                {report.sheets.length} sheet{report.sheets.length === 1 ? "" : "s"}, generated{" "}
                {new Date(report.generatedAt).toLocaleString()}.
              </p>
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
