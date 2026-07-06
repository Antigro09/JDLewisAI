"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Chrome } from "lucide-react";
import { Button, Card, Input, Label } from "@/components/ui";
import { signInAction, signUpAction, type AuthState } from "./actions";

export function AuthForm({
  mode,
  next,
  googleStatus,
}: {
  mode: "signin" | "signup";
  next?: string;
  googleStatus?: string;
}) {
  const action = mode === "signin" ? signInAction : signUpAction;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    action,
    {},
  );
  const googleHref = `/api/auth/google?next=${encodeURIComponent(next ?? "/chat")}`;
  const googleError =
    googleStatus === "unconfigured"
      ? "Google sign-in is not configured yet."
      : googleStatus === "denied"
        ? "Google sign-in was cancelled."
        : googleStatus === "domain"
          ? "That Google account is not allowed for this workspace."
          : googleStatus === "disabled"
            ? "That account is disabled."
            : googleStatus === "error"
              ? "Google sign-in failed. Please try again."
              : null;

  return (
    <Card className="p-6">
      <a
        href={googleHref}
        className="mb-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
      >
          <Chrome size={16} />
          {mode === "signin" ? "Sign in with Google" : "Sign up with Google"}
      </a>
      <div className="mb-4 flex items-center gap-3 text-xs text-neutral-400">
        <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
        <span>or</span>
        <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
      </div>
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next ?? "/chat"} />
        {mode === "signup" && (
          <div>
            <Label htmlFor="name">Full name</Label>
            <Input id="name" name="name" autoComplete="name" required />
          </div>
        )}
        <div>
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={mode === "signup" ? 10 : undefined}
            required
          />
        </div>

        {(state.error || googleError) && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {state.error || googleError}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending
            ? "Please wait…"
            : mode === "signin"
              ? "Sign in"
              : "Create account"}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-neutral-500">
        {mode === "signin" ? (
          <>
            No account?{" "}
            <Link href="/signup" className="font-medium text-brand-600 hover:underline">
              Sign up
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-brand-600 hover:underline">
              Sign in
            </Link>
          </>
        )}
      </p>
    </Card>
  );
}
