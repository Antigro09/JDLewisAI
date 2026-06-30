"use client";

import { useActionState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, Label, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { Markdown } from "@/components/markdown";
import { DownloadButton } from "@/components/download-button";
import { MODELS, ALL_EFFORTS } from "@/lib/claude/models";
import { analyzePlanAction, type PlanState } from "./actions";

export default function PlansPage() {
  const [state, action] = useActionState<PlanState, FormData>(
    analyzePlanAction,
    {},
  );

  return (
    <PageShell
      title="Plan Reader"
      description="Upload a floor, electrical, structural, or MEP plan (image or PDF). The AI reads it and writes up what it sees."
    >
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
                className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
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
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {state.error}
              </p>
            )}
          </form>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Analysis</h3>
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
    </PageShell>
  );
}
