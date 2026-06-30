import Link from "next/link";
import { cn } from "@/lib/utils";

export function Tabs({
  tabs,
  active,
  basePath,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  basePath: string;
}) {
  return (
    <div className="mb-6 flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={`${basePath}?tab=${t.id}`}
          className={cn(
            "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            active === t.id
              ? "border-brand-600 text-brand-700 dark:border-brand-500 dark:text-brand-400"
              : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
