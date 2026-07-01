"use client";

import { useActionState } from "react";
import { Card, Input, Label } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { runCalculator, type CalcState } from "./actions";

type Field = { name: string; label: string; placeholder?: string; type?: string };

export function CalcCard({
  tool,
  title,
  blurb,
  fields,
}: {
  tool: string;
  title: string;
  blurb: string;
  fields: Field[];
}) {
  const [state, action] = useActionState<CalcState, FormData>(runCalculator, {});
  return (
    <Card className="p-5">
      <h3 className="font-semibold dark:text-neutral-100">{title}</h3>
      <p className="mb-3 mt-0.5 text-xs text-neutral-400">{blurb}</p>
      <form action={action} className="space-y-3">
        <input type="hidden" name="tool" value={tool} />
        <div className="grid grid-cols-2 gap-3">
          {fields.map((f) => (
            <div key={f.name}>
              <Label htmlFor={`${tool}-${f.name}`}>{f.label}</Label>
              <Input
                id={`${tool}-${f.name}`}
                name={f.name}
                type={f.type ?? "text"}
                step="any"
                placeholder={f.placeholder}
              />
            </div>
          ))}
        </div>
        <SubmitButton size="sm" pendingText="Calculating…">
          Calculate
        </SubmitButton>
      </form>
      {state.error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </p>
      )}
      {state.summary && (
        <div className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800 dark:bg-brand-950 dark:text-brand-200">
          {state.summary}
        </div>
      )}
    </Card>
  );
}
