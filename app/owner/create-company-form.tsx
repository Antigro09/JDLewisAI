"use client";

import { useActionState } from "react";
import { Input, Label } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createCompanyWithAdmin, type CreateCompanyState } from "./actions";

export function CreateCompanyForm() {
  const [state, formAction] = useActionState<CreateCompanyState, FormData>(
    createCompanyWithAdmin,
    {},
  );

  return (
    <div className="space-y-4">
      <form action={formAction} className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="companyName">Company name</Label>
          <Input id="companyName" name="companyName" required />
        </div>
        <div>
          <Label htmlFor="adminName">Admin name</Label>
          <Input id="adminName" name="adminName" autoComplete="off" required />
        </div>
        <div>
          <Label htmlFor="adminEmail">Admin email</Label>
          <Input
            id="adminEmail"
            name="adminEmail"
            type="email"
            autoComplete="off"
            required
          />
        </div>
        <div className="sm:col-span-3">
          <SubmitButton size="sm">Create company</SubmitButton>
        </div>
      </form>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </p>
      )}
      {state.ok && (
        <div className="rounded-lg border border-ember-border bg-ember-subtle px-4 py-3 text-sm">
          <p className="font-medium text-ember-text">
            Company created. Hand these credentials to the client:
          </p>
          <p className="mt-1 font-mono text-ember-text">
            {state.email} / {state.tempPassword}
          </p>
          <p className="mt-1 text-xs text-ember-faint">
            Shown once — it isn&apos;t stored anywhere. Copy it now; they should
            change it after first sign-in.
          </p>
        </div>
      )}
    </div>
  );
}
