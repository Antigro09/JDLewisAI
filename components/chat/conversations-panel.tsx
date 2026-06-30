"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { cn, truncate } from "@/lib/utils";

export type ConvListItem = { id: string; title: string };

export function ConversationsPanel({ items }: { items: ConvListItem[] }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <div className="p-3">
        <Link
          href="/chat"
          className="flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus size={16} />
          New chat
        </Link>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {items.length === 0 && (
          <p className="px-3 py-2 text-sm text-neutral-400">No conversations yet.</p>
        )}
        {items.map((c) => {
          const active = pathname === `/chat/${c.id}`;
          return (
            <Link
              key={c.id}
              href={`/chat/${c.id}`}
              className={cn(
                "block truncate rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-brand-50 text-brand-700"
                  : "text-neutral-600 hover:bg-neutral-100",
              )}
            >
              {truncate(c.title, 32)}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
