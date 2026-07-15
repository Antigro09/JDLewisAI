"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * Returns to the page the reader came from (sign-in/up, accept-terms, …);
 * falls back to /login when the doc was opened directly in a fresh tab.
 */
export function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push("/login");
      }}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-ember-faint transition-colors hover:bg-ember-bg hover:text-ember-text"
    >
      <ArrowLeft size={16} />
      Back
    </button>
  );
}
