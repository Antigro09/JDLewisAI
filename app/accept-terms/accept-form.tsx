"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui";
import { acceptTermsAction, type AcceptTermsState } from "./actions";

export function AcceptTermsForm() {
  const [state, formAction, pending] = useActionState<AcceptTermsState, FormData>(
    acceptTermsAction,
    {},
  );
  const [agreed, setAgreed] = useState(false);

  return (
    <form action={formAction} className="space-y-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="agree"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1"
        />
        <span className="text-sm text-ember-text">
          I have read and agree to the ContractorAI Terms of Service and{" "}
          <a
            href="/legal/privacy"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Privacy Policy
          </a>
          .
        </span>
      </label>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={!agreed || pending}>
        {pending ? "Please wait…" : "Agree and continue"}
      </Button>
    </form>
  );
}
