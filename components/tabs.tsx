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
    <div className="mb-6 inline-flex gap-1 rounded-full bg-ember-subtle p-1">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={`${basePath}?tab=${t.id}`}
          className={cn(
            "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors duration-200",
            active === t.id
              ? "bg-ember-accent-solid text-white shadow-ember-card"
              : "text-ember-muted hover:text-ember-text",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
