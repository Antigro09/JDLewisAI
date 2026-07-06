import type { InvoiceStatus } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const SUCCESS = "bg-ember-success-bg text-ember-success";
const WARNING = "bg-ember-warning-bg text-ember-warning";
const DANGER = "bg-ember-danger-bg text-ember-danger";
const PENDING = "bg-ember-pending-bg text-ember-pending";

const STYLES: Record<string, string> = {
  APPROVED: SUCCESS,
  APPROVED_AS_NOTED: SUCCESS,
  NEEDS_REVIEW: WARNING,
  REVISE: WARNING,
  SUBMITTED: WARNING,
  ANSWERED: WARNING,
  OPEN: WARNING,
  DENIED: DANGER,
  REJECTED: DANGER,
  PENDING: PENDING,
  DRAFT: PENDING,
  CLOSED: PENDING,
};

const LABELS: Record<string, string> = {
  APPROVED: "Approved",
  APPROVED_AS_NOTED: "Approved as Noted",
  NEEDS_REVIEW: "Needs Review",
  REVISE: "Revise & Resubmit",
  SUBMITTED: "Submitted",
  ANSWERED: "Answered",
  DENIED: "Denied",
  REJECTED: "Rejected",
  PENDING: "Pending",
  DRAFT: "Draft",
  OPEN: "Open",
  CLOSED: "Closed",
};

export function StatusBadge({
  status,
  size = "sm",
}: {
  status: string;
  size?: "sm" | "lg";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold uppercase tracking-wide",
        STYLES[status] ?? PENDING,
        size === "lg" ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-[11.5px]",
      )}
    >
      {LABELS[status] ?? status}
    </span>
  );
}

/** Big diagonal "stamp" overlay for the invoice document view. */
export function StatusStamp({ status }: { status: InvoiceStatus }) {
  if (status === "PENDING") return null;
  const color =
    status === "APPROVED"
      ? "border-ember-success text-ember-success"
      : status === "DENIED"
        ? "border-ember-danger text-ember-danger"
        : "border-ember-warning text-ember-warning";
  return (
    <div
      className={cn(
        "pointer-events-none absolute right-3 top-3 -rotate-[9deg] rounded-md border-[3px] px-3 py-1 font-serif text-lg font-bold uppercase tracking-wide opacity-85",
        color,
      )}
    >
      {LABELS[status]}
    </div>
  );
}
