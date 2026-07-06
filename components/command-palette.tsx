"use client";

// ⌘K command palette — search-driven access to the long tail of document
// tools. Opens via Cmd/Ctrl+K anywhere or the sidebar "Find a tool…" button;
// Esc closes. Grouped, live substring filtering, glass panel. Every item is a
// real route.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  SearchX,
  FileText,
  HelpCircle,
  ClipboardList,
  FilePlus2,
  CalendarDays,
  Receipt,
  Layers,
  Scale,
  Package,
  Map as MapIcon,
  Camera,
  Calculator,
  Siren,
  type LucideIcon,
} from "lucide-react";

type Item = { label: string; href: string; icon: LucideIcon };
type Group = { heading: string; items: Item[] };

const GROUPS: Group[] = [
  {
    heading: "Documents",
    items: [
      { label: "Scopes of Work", href: "/scopes", icon: FileText },
      { label: "RFIs", href: "/rfis", icon: HelpCircle },
      { label: "Submittal Log", href: "/submittals", icon: ClipboardList },
      { label: "Change Orders", href: "/changes", icon: FilePlus2 },
      { label: "Daily Reports", href: "/reports", icon: CalendarDays },
    ],
  },
  {
    heading: "Financial",
    items: [
      { label: "Invoices", href: "/invoices", icon: Receipt },
      { label: "Invoice Roll-Up", href: "/invoice-rollup", icon: Layers },
      { label: "Bid Comparison", href: "/bids", icon: Scale },
      { label: "Material Takeoff", href: "/material-takeoff", icon: Package },
    ],
  },
  {
    heading: "Field",
    items: [
      { label: "Plan Reader", href: "/plans", icon: MapIcon },
      { label: "Field Capture", href: "/capture", icon: Camera },
      { label: "Calculators", href: "/calculators", icon: Calculator },
      { label: "Emergency Plan", href: "/eap", icon: Siren },
    ],
  },
  {
    heading: "Search",
    items: [{ label: "Project Search", href: "/search", icon: Search }],
  },
];

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Global ⌘K / Ctrl+K toggle + Esc close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      } else if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Reset query + focus input each time it opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GROUPS;
    return GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((i) => i.label.toLowerCase().includes(q)),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 px-4 pt-[14vh] backdrop-blur-[2px]"
      onClick={() => onOpenChange(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Find a tool"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "emb-pop .22s cubic-bezier(0.23,1,0.32,1) both" }}
        className="w-[580px] max-w-[92vw] overflow-hidden rounded-[26px] border border-ember-border bg-ember-surface/80 shadow-ember-palette backdrop-blur-2xl"
      >
        <div className="flex items-center gap-3 border-b border-ember-border px-5 py-4">
          <Search size={18} className="shrink-0 text-ember-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search scopes, invoices, RFIs, calculators…"
            className="w-full bg-transparent text-[15px] text-ember-text placeholder:text-ember-faint focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded-md border border-ember-border px-1.5 py-0.5 text-[11px] font-medium text-ember-faint sm:block">
            Esc
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-3">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <SearchX size={26} className="text-ember-faint" />
              <p className="text-sm text-ember-muted">
                Nothing matches “{query.trim()}”
              </p>
            </div>
          ) : (
            filtered.map((group) => (
              <div key={group.heading} className="mb-3 last:mb-0">
                <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ember-faint">
                  {group.heading}
                </div>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.href}
                        type="button"
                        onClick={() => go(item.href)}
                        className="group flex items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-[background,transform] duration-200 ease-ember-spring hover:translate-x-[3px] hover:bg-ember-subtle"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ember-subtle text-ember-muted transition-colors group-hover:bg-ember-tint group-hover:text-ember-tint-text">
                          <Icon size={16} />
                        </span>
                        <span className="truncate text-sm font-medium text-ember-text">
                          {item.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
