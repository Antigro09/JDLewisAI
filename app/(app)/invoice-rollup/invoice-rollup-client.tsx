"use client";

import { useActionState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, Input, Label } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { runRollupAction, type RollupState } from "./actions";

export function InvoiceRollupClient() {
  const [state, action] = useActionState<RollupState, FormData>(
    runRollupAction,
    {},
  );

  return (
    <PageShell
      title="Invoice Roll-Up"
      description="Aggregate quantities by product across every invoice in a Google Drive folder, and write the totals to a real Sheet."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <form action={action} className="space-y-3">
            <div>
              <Label htmlFor="folder">Drive folder link or ID</Label>
              <Input
                id="folder"
                name="folder"
                placeholder="https://drive.google.com/drive/folders/…"
                required
              />
              <p className="mt-1 text-xs text-neutral-400">
                Reads PDF/image invoices in the folder (up to 25), extracts line items, and
                sums quantities by product/material across all of them.
              </p>
            </div>
            <SubmitButton pendingText="Reading invoices…">Generate roll-up</SubmitButton>
            {state.error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                {state.error}
              </p>
            )}
          </form>
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 font-semibold dark:text-neutral-100">Result</h3>
          {state.sheetLink ? (
            <div className="space-y-3">
              <a
                href={state.sheetLink}
                target="_blank"
                rel="noreferrer"
                className="inline-block rounded-lg bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100 dark:bg-brand-950 dark:text-brand-300"
              >
                Open the Sheet →
              </a>
              <p className="text-xs text-neutral-400">
                {state.filesProcessed} invoice{state.filesProcessed === 1 ? "" : "s"} processed
                {state.filesSkipped ? `, ${state.filesSkipped} skipped (not PDF/image or over the 25-file cap)` : ""}.
              </p>
              {state.rows && state.rows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-400 dark:border-neutral-800">
                        <th className="py-1 pr-2">Product</th>
                        <th className="whitespace-nowrap py-1 pr-2">Total Qty</th>
                        <th className="whitespace-nowrap py-1 pr-2">Unit</th>
                        <th className="whitespace-nowrap py-1">Invoices</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.rows.map((r, i) => (
                        <tr key={i} className="border-b border-neutral-100 dark:border-neutral-800">
                          <td className="py-1 pr-2 dark:text-neutral-200">{r.product}</td>
                          <td className="whitespace-nowrap py-1 pr-2 dark:text-neutral-200">{r.totalQuantity}</td>
                          <td className="whitespace-nowrap py-1 pr-2 text-neutral-500 dark:text-neutral-400">{r.unit ?? "—"}</td>
                          <td className="whitespace-nowrap py-1 text-neutral-500 dark:text-neutral-400">{r.sourceCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-neutral-400">
              Paste a folder link and generate to see the aggregated totals here.
            </p>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
