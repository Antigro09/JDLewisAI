"use client";

import { useActionState, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Badge, Card, Input, Label, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { Markdown } from "@/components/markdown";
import { DownloadButton } from "@/components/download-button";
import { MODELS, ALL_EFFORTS } from "@/lib/claude/models";
import {
  analyzePlanAction,
  analyzeDoorFramingAction,
  type PlanState,
  type TakeoffPlanState,
} from "./actions";

export default function PlansPage() {
  const [mode, setMode] = useState<"standard" | "takeoff">("standard");
  const [state, action] = useActionState<PlanState, FormData>(
    analyzePlanAction,
    {},
  );
  const [takeoffState, takeoffAction] = useActionState<TakeoffPlanState, FormData>(
    analyzeDoorFramingAction,
    {},
  );

  return (
    <PageShell
      title="Plan Reader"
      description="Upload a floor, electrical, structural, or MEP plan (image or PDF). The AI reads it and writes up what it sees."
    >
      <div className="mb-4 grid grid-cols-2 gap-2 sm:w-96">
        <button
          type="button"
          onClick={() => setMode("standard")}
          className={`rounded-lg border px-3 py-2 text-sm font-medium ${
            mode === "standard"
              ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300"
              : "border-neutral-200 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400"
          }`}
        >
          Standard Review
        </button>
        <button
          type="button"
          onClick={() => setMode("takeoff")}
          className={`rounded-lg border px-3 py-2 text-sm font-medium ${
            mode === "takeoff"
              ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300"
              : "border-neutral-200 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400"
          }`}
        >
          Door &amp; Framing Takeoff
        </button>
      </div>

      {mode === "standard" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-5">
            <form action={action} className="space-y-3">
              <div>
                <Label>Plan file (image or PDF)</Label>
                <input
                  type="file"
                  name="file"
                  accept="image/*,application/pdf"
                  required
                  className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100 dark:text-neutral-300"
                />
              </div>
              <div>
                <Label htmlFor="question">Specific question (optional)</Label>
                <Textarea
                  id="question"
                  name="question"
                  rows={3}
                  placeholder="e.g. How many 20A circuits are on Panel A? What's the ceiling height in the lobby?"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="model">Model</Label>
                  <Select id="model" name="model" defaultValue="claude-opus-4-8" className="h-10 w-full">
                    {MODELS.filter((m) => m.enabled).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="effort">Effort</Label>
                  <Select id="effort" name="effort" defaultValue="high" className="h-10 w-full">
                    {ALL_EFFORTS.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <SubmitButton pendingText="Analyzing…">Analyze plan</SubmitButton>
              {state.error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                  {state.error}
                </p>
              )}
            </form>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold dark:text-neutral-100">Analysis</h3>
              {state.markdown && (
                <DownloadButton
                  content={state.markdown}
                  filename={`${(state.fileName || "plan").replace(/\.[^.]+$/, "")}-analysis.md`}
                  label="Download .md"
                />
              )}
            </div>
            {state.markdown ? (
              <Markdown content={state.markdown} />
            ) : (
              <p className="text-sm text-neutral-400">
                Upload a plan to see the AI&apos;s read-out here.
              </p>
            )}
          </Card>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-5">
            <form action={takeoffAction} className="space-y-3">
              <div>
                <Label>Plan file (image or PDF)</Label>
                <input
                  type="file"
                  name="file"
                  accept="image/*,application/pdf"
                  required
                  className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100 dark:text-neutral-300"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="wallThicknessIn">Wall thickness (in)</Label>
                  <Input id="wallThicknessIn" name="wallThicknessIn" type="number" step="0.25" defaultValue="4.5" />
                </div>
                <div>
                  <Label htmlFor="studSpacingIn">Stud spacing (in o.c.)</Label>
                  <Input id="studSpacingIn" name="studSpacingIn" type="number" step="1" defaultValue="16" />
                </div>
                <div>
                  <Label htmlFor="studSize">Stud size</Label>
                  <Select id="studSize" name="studSize" defaultValue="2x4" className="h-10 w-full">
                    <option value="2x4">2x4</option>
                    <option value="2x6">2x6</option>
                    <option value="2x8">2x8</option>
                  </Select>
                </div>
              </div>
              <SubmitButton pendingText="Reading plan…">Generate takeoff</SubmitButton>
              {takeoffState.error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                  {takeoffState.error}
                </p>
              )}
            </form>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 font-semibold dark:text-neutral-100">Takeoff</h3>
            {takeoffState.data ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                    <div className="text-xs uppercase text-neutral-400">Total Doors</div>
                    <div className="text-xl font-bold dark:text-neutral-100">{takeoffState.data.totalDoors}</div>
                  </div>
                  <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                    <div className="text-xs uppercase text-neutral-400">
                      Framing — <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">Estimated</Badge>
                    </div>
                    <div className="text-xl font-bold dark:text-neutral-100">
                      {takeoffState.data.framingLinearFeet.toLocaleString()} LF
                    </div>
                  </div>
                </div>

                {takeoffState.data.doors.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-400 dark:border-neutral-800">
                          <th className="py-1 pr-2">Type</th>
                          <th className="py-1 pr-2">Size</th>
                          <th className="py-1 pr-2">Swing</th>
                          <th className="py-1 pr-2">Count</th>
                          <th className="py-1">Location</th>
                        </tr>
                      </thead>
                      <tbody>
                        {takeoffState.data.doors.map((d) => (
                          <tr key={d.id} className="border-b border-neutral-100 dark:border-neutral-800">
                            <td className="py-1 pr-2 dark:text-neutral-200">{d.type}</td>
                            <td className="py-1 pr-2 text-neutral-500 dark:text-neutral-400">
                              {d.widthIn && d.heightIn ? `${d.widthIn}" × ${d.heightIn}"` : "—"}
                            </td>
                            <td className="py-1 pr-2 text-neutral-500 dark:text-neutral-400">{d.swing ?? "—"}</td>
                            <td className="py-1 pr-2 dark:text-neutral-200">{d.count}</td>
                            <td className="py-1 text-neutral-500 dark:text-neutral-400">{d.location ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {takeoffState.data.framingNotes && (
                  <p className="text-sm text-neutral-600 dark:text-neutral-300">
                    {takeoffState.data.framingNotes}
                  </p>
                )}

                {takeoffState.data.assumptions.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    <div className="mb-1 font-semibold">Assumptions</div>
                    <ul className="list-disc space-y-0.5 pl-5">
                      {takeoffState.data.assumptions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-neutral-400">
                Upload a plan and set wall framing inputs to see a door inventory and an
                estimated framing takeoff here.
              </p>
            )}
          </Card>
        </div>
      )}
    </PageShell>
  );
}
