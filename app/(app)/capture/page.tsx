"use client";

import { useActionState, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, Label, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { Markdown } from "@/components/markdown";
import { captureAndAnalyzeAction, type CaptureState } from "./actions";

export default function CapturePage() {
  const [state, action] = useActionState<CaptureState, FormData>(
    captureAndAnalyzeAction,
    {},
  );
  const [kind, setKind] = useState<"plan" | "invoice">("plan");

  return (
    <PageShell
      title="Field Capture"
      description="Snap a photo from your phone — a plan, drawing, or invoice — and let the AI read it on the spot."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <form action={action} className="space-y-4">
            <div>
              <Label>What are you capturing?</Label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setKind("plan")}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                    kind === "plan"
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-neutral-200 text-neutral-600"
                  }`}
                >
                  Plan / Drawing
                </button>
                <button
                  type="button"
                  onClick={() => setKind("invoice")}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                    kind === "invoice"
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-neutral-200 text-neutral-600"
                  }`}
                >
                  Invoice
                </button>
              </div>
              <input type="hidden" name="kind" value={kind} />
            </div>

            <div>
              <Label>Photo</Label>
              <input
                type="file"
                name="file"
                accept="image/*,application/pdf"
                capture="environment"
                required
                className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-3 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
              />
              <p className="mt-1 text-xs text-neutral-400">
                On mobile this opens your camera directly. You can also pick an existing photo or PDF.
              </p>
            </div>

            {kind === "plan" && (
              <div>
                <Label htmlFor="question">Specific question (optional)</Label>
                <Textarea
                  id="question"
                  name="question"
                  rows={3}
                  placeholder="e.g. What's the ceiling height here? How many outlets on this wall?"
                />
              </div>
            )}

            <SubmitButton pendingText="Reading…">
              {kind === "invoice" ? "Extract invoice" : "Analyze plan"}
            </SubmitButton>

            {state.error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {state.error}
              </p>
            )}
          </form>
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 font-semibold">Result</h3>
          {state.markdown ? (
            <Markdown content={state.markdown} />
          ) : (
            <p className="text-sm text-neutral-400">
              Take or choose a photo to see the AI&apos;s read-out here. Invoices open
              directly in the review screen.
            </p>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
