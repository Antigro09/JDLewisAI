"use client";

import { useActionState, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Button, Card, Input, Label, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { Markdown } from "@/components/markdown";
import { DownloadButton } from "@/components/download-button";
import { BrandedDocument } from "@/components/branded-document";
import { MODELS, ALL_EFFORTS } from "@/lib/claude/models";
import type { DocumentTemplate } from "@/lib/db/schema";
import { generateEapAction, type EapState } from "./actions";

export function EapClient({ template }: { template: DocumentTemplate | null }) {
  const [state, action] = useActionState<EapState, FormData>(
    generateEapAction,
    {},
  );
  const [branded, setBranded] = useState(false);

  if (branded && state.markdown) {
    return (
      <div>
        <div className="no-print px-6 pt-6">
          <Button variant="secondary" size="sm" onClick={() => setBranded(false)}>
            ← Back to editor
          </Button>
        </div>
        <BrandedDocument
          title={`Emergency Action Plan — ${state.projectName || "Project"}`}
          markdown={state.markdown}
          template={template}
        />
      </div>
    );
  }

  return (
    <PageShell
      title="Emergency Action Plan"
      description="Generate a complete EAP from the company template, filled in with project details."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <form action={action} className="space-y-3">
            <div>
              <Label htmlFor="projectName">Project name</Label>
              <Input id="projectName" name="projectName" required />
            </div>
            <div>
              <Label htmlFor="address">Project address</Label>
              <Input id="address" name="address" placeholder="Street, city, state" />
            </div>
            <div>
              <Label htmlFor="details">Details</Label>
              <Textarea
                id="details"
                name="details"
                rows={5}
                placeholder="Site contacts, nearest hospital, known hazards, alarm type, assembly point, anything specific to this site…"
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
            <SubmitButton pendingText="Generating…">Generate EAP</SubmitButton>
            {state.error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                {state.error}
              </p>
            )}
          </form>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold dark:text-neutral-100">Emergency Action Plan</h3>
            {state.markdown && (
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setBranded(true)}>
                  View branded
                </Button>
                <DownloadButton
                  content={state.markdown}
                  filename={`${(state.projectName || "project").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-eap.md`}
                  label="Download .md"
                />
              </div>
            )}
          </div>
          {state.markdown ? (
            <Markdown content={state.markdown} />
          ) : (
            <p className="text-sm text-neutral-400">
              Fill in the details and generate to see the plan here.
            </p>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
