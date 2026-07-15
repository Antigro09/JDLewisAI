"use client";

import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui";
import { TAKEOFF_UI_CAPTION } from "@/lib/legal/disclaimers";
import type { MaterialLine, TakeoffIssue, TakeoffReport } from "@/lib/tools/material-takeoff";

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

export function tradeLabel(trade: string): string {
  return TRADE_LABELS[trade] ?? trade;
}

function IssueRow({ issue }: { issue: TakeoffIssue }) {
  const cls =
    issue.severity === "error"
      ? "bg-ember-danger-bg text-ember-danger"
      : "bg-ember-warning-bg text-ember-warning";
  return (
    <li className={`rounded-lg px-3 py-2 text-sm ${cls}`}>
      <span className="font-medium">{issue.where}:</span> {issue.message}
    </li>
  );
}

function MaterialRows({ line }: { line: MaterialLine }) {
  return (
    <tr className="border-b border-neutral-100 align-top dark:border-neutral-800">
      <td className="py-1.5 pr-2 text-ember-text">
        {line.description}
        <div className="mt-0.5 text-xs text-ember-muted">
          {line.basis}
          {line.assumptions.length > 0 && <span> - Assumes: {line.assumptions.join("; ")}</span>}
        </div>
      </td>
      <td className="whitespace-nowrap py-1.5 pr-2 text-right font-medium tabular-nums text-ember-text">
        {line.quantityPurchase.toLocaleString()}
      </td>
      <td className="whitespace-nowrap py-1.5 pr-2 text-ember-muted">{line.unit}</td>
      <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums text-ember-muted">
        {line.quantityExact.toLocaleString()}
      </td>
      <td className="whitespace-nowrap py-1.5 text-right tabular-nums text-ember-muted">
        {line.wastePct}%
      </td>
    </tr>
  );
}

export function MaterialsPreview({
  report,
  sheetLink,
  onExportSheet,
  googleConnected,
  busy,
}: {
  report: TakeoffReport | null;
  sheetLink?: string;
  onExportSheet: () => void;
  googleConnected: boolean;
  busy?: boolean;
}) {
  return (
    <div className="flex min-h-[300px] flex-col overflow-hidden rounded-[18px] border border-ember-border bg-ember-surface shadow-ember-card">
      <div className="flex items-center justify-between gap-3 border-b border-ember-border px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold text-ember-text">Materials</h2>
          <p className="text-xs text-ember-muted">
            {report ? `${report.measurements.length} measurements bridged` : "No bridged report yet"}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-ember-faint">
            {TAKEOFF_UI_CAPTION}
          </p>
        </div>
        {sheetLink ? (
          <a
            href={sheetLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-2 rounded-full px-3 text-sm font-semibold text-ember-accent hover:bg-ember-subtle"
          >
            <ExternalLink size={15} />
            Sheet
          </a>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!report || !googleConnected || busy}
            onClick={onExportSheet}
          >
            <ExternalLink size={15} />
            Sheet
          </Button>
        )}
      </div>
      <div className="max-h-[560px] flex-1 overflow-y-auto p-3">
        {!report ? (
          <p className="text-sm text-ember-muted">Reviewed engine quantities will appear here as CSI material lines.</p>
        ) : report.divisions.length === 0 ? (
          <p className="text-sm text-ember-muted">No material lines are ready yet.</p>
        ) : (
          <div className="space-y-5">
            {report.divisions.map((div) => (
              <section key={div.division}>
                <h3 className="mb-2 text-sm font-semibold text-ember-text">
                  Division {div.division} - {div.divisionTitle}
                </h3>
                <div className="space-y-3">
                  {div.trades.map((section) => (
                    <div key={section.trade}>
                      <h4 className="mb-1 text-xs font-semibold uppercase text-ember-muted">
                        {tradeLabel(section.trade)}
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-neutral-200 text-left text-xs uppercase text-ember-muted dark:border-neutral-800">
                              <th className="py-1 pr-2">Material</th>
                              <th className="whitespace-nowrap py-1 pr-2 text-right">Buy Qty</th>
                              <th className="whitespace-nowrap py-1 pr-2">Unit</th>
                              <th className="whitespace-nowrap py-1 pr-2 text-right">Exact</th>
                              <th className="whitespace-nowrap py-1 text-right">Waste</th>
                            </tr>
                          </thead>
                          <tbody>
                            {section.materials.map((line, index) => (
                              <MaterialRows key={index} line={line} />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
        {report?.issues && report.issues.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 text-sm font-semibold text-ember-text">
              Issues & review notes ({report.issues.length})
            </h3>
            <ul className="space-y-2">
              {report.issues.map((issue, index) => (
                <IssueRow key={index} issue={issue} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
