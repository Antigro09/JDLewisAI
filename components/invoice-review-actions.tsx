"use client";

// The invoice "Review" card — a deliberate, expressive moment. Approve /
// Needs Review / Deny each ripple from the click point; approving flashes a
// "✓ Approved" badge. The buttons keep the existing server-action bindings
// (setInvoiceStatus), so the status still mutates live via revalidatePath.

import { useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label, Textarea } from "@/components/ui";
import { setInvoiceStatus } from "@/app/(app)/invoices/actions";

type Ripple = { id: number; x: number; y: number; color: string };

const ACTIONS = [
  {
    status: "APPROVED" as const,
    label: "Approve",
    ripple: "oklch(0.58 0.13 150 / 0.4)",
    className:
      "bg-ember-success text-white hover:brightness-105",
  },
  {
    status: "NEEDS_REVIEW" as const,
    label: "Needs Review",
    ripple: "oklch(0.68 0.14 70 / 0.4)",
    className:
      "border border-ember-border bg-ember-surface text-ember-text hover:bg-ember-subtle",
  },
  {
    status: "DENIED" as const,
    label: "Deny",
    ripple: "oklch(0.56 0.18 22 / 0.4)",
    className:
      "border border-ember-border bg-ember-surface text-ember-danger hover:bg-ember-subtle",
  },
];

export function InvoiceReviewActions({ invoiceId }: { invoiceId: string }) {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [approveFlash, setApproveFlash] = useState(false);
  const rippleId = useRef(0);

  const onClick = (
    e: React.MouseEvent<HTMLButtonElement>,
    color: string,
    isApprove: boolean,
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const id = ++rippleId.current;
    setRipples((r) => [
      ...r,
      { id, x: e.clientX - rect.left, y: e.clientY - rect.top, color },
    ]);
    setTimeout(() => setRipples((r) => r.filter((x) => x.id !== id)), 550);
    if (isApprove) {
      setApproveFlash(true);
      setTimeout(() => setApproveFlash(false), 1100);
    }
    // The form still submits; setInvoiceStatus runs and revalidates the page.
  };

  return (
    <div className="rounded-[18px] border border-ember-border bg-ember-surface p-5 shadow-ember-card">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="font-semibold text-ember-text">Review</h3>
        {approveFlash && (
          <span
            className="inline-flex items-center gap-1 text-sm font-semibold text-ember-success"
            style={{ animation: "emb-check-flash 1.1s ease-out forwards" }}
          >
            <CheckCircle2 size={15} /> Approved
          </span>
        )}
      </div>
      <form className="space-y-3">
        <div>
          <Label htmlFor="note">Note (optional)</Label>
          <Textarea id="note" name="note" rows={2} />
        </div>
        <div className="flex flex-wrap gap-2">
          {ACTIONS.map((a) => (
            <button
              key={a.status}
              type="submit"
              formAction={setInvoiceStatus.bind(null, invoiceId, a.status)}
              onClick={(e) => onClick(e, a.ripple, a.status === "APPROVED")}
              className={cn(
                "relative h-10 overflow-hidden rounded-full px-5 text-sm font-semibold transition-transform duration-150 ease-ember-spring hover:-translate-y-0.5 active:scale-[0.93]",
                a.className,
              )}
            >
              {a.label}
              {ripples.map((r) => (
                <span
                  key={r.id}
                  className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    left: r.x,
                    top: r.y,
                    background: r.color,
                    animation: "emb-ripple .55s ease-out forwards",
                  }}
                />
              ))}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
