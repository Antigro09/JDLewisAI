import type { InvoiceStatus } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const STYLES: Record<InvoiceStatus, string> = {
  APPROVED: "bg-green-100 text-green-800 ring-green-300",
  NEEDS_REVIEW: "bg-amber-100 text-amber-800 ring-amber-300",
  DENIED: "bg-red-100 text-red-800 ring-red-300",
  PENDING: "bg-neutral-100 text-neutral-600 ring-neutral-300",
};

const LABELS: Record<InvoiceStatus, string> = {
  APPROVED: "Approved",
  NEEDS_REVIEW: "Needs Review",
  DENIED: "Denied",
  PENDING: "Pending",
};

export function StatusBadge({
  status,
  size = "sm",
}: {
  status: InvoiceStatus;
  size?: "sm" | "lg";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold uppercase tracking-wide ring-1",
        STYLES[status],
        size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs",
      )}
    >
      {LABELS[status]}
    </span>
  );
}

/** Big diagonal "stamp" overlay for the invoice document view. */
export function StatusStamp({ status }: { status: InvoiceStatus }) {
  if (status === "PENDING") return null;
  const color =
    status === "APPROVED"
      ? "border-green-600 text-green-600"
      : status === "DENIED"
        ? "border-red-600 text-red-600"
        : "border-amber-600 text-amber-600";
  return (
    <div
      className={cn(
        "pointer-events-none absolute right-3 top-3 -rotate-12 rounded-md border-4 px-3 py-1 text-lg font-extrabold uppercase opacity-80",
        color,
      )}
    >
      {LABELS[status]}
    </div>
  );
}
