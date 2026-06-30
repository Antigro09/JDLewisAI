"use client";

import { useActionState } from "react";
import { Input, Label } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { changePassword, type ChangePasswordState } from "@/app/(app)/settings/actions";

export function ChangePasswordForm() {
  const [state, action] = useActionState<ChangePasswordState, FormData>(
    changePassword,
    {},
  );
  return (
    <form action={action} className="space-y-3">
      <div>
        <Label htmlFor="currentPassword">Current password</Label>
        <Input id="currentPassword" name="currentPassword" type="password" required />
      </div>
      <div>
        <Label htmlFor="newPassword">New password</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          minLength={8}
          required
        />
      </div>
      <div>
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          minLength={8}
          required
        />
      </div>
      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          Password updated.
        </p>
      )}
      <SubmitButton size="sm" pendingText="Saving…">
        Change password
      </SubmitButton>
    </form>
  );
}
