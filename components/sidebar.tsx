"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageSquare,
  FolderKanban,
  FileText,
  Receipt,
  Map,
  ShieldAlert,
  Workflow,
  AudioLines,
  Sparkles,
  Settings,
  Users,
  LogOut,
  HelpCircle,
  ClipboardList,
  FilePlus2,
  CalendarDays,
  Scale,
  Search,
  Camera,
  Calculator,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/app/(auth)/actions";
import { SidebarConversations } from "@/components/sidebar-conversations";
import { NotificationBell } from "@/components/notification-bell";

const PRIMARY_NAV = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/meetings", label: "Meetings", icon: AudioLines },
  { href: "/automations", label: "Automations", icon: Workflow },
  { href: "/customize", label: "Customize", icon: Sparkles },
];

const MORE_NAV = [
  { href: "/scopes", label: "Scopes of Work", icon: FileText },
  { href: "/invoices", label: "Invoices", icon: Receipt },
  { href: "/plans", label: "Plan Reader", icon: Map },
  { href: "/material-takeoff", label: "Material Takeoff", icon: Scale },
  { href: "/calculators", label: "Calculators", icon: Calculator },
  { href: "/capture", label: "Field Capture", icon: Camera },
  { href: "/eap", label: "Emergency Plan", icon: ShieldAlert },
  { href: "/rfis", label: "RFIs", icon: HelpCircle },
  { href: "/submittals", label: "Submittal Log", icon: ClipboardList },
  { href: "/changes", label: "Change Orders", icon: FilePlus2 },
  { href: "/reports", label: "Daily Reports", icon: CalendarDays },
  { href: "/bids", label: "Bid Comparison", icon: Scale },
  { href: "/search", label: "Project Search", icon: Search },
];

const COLLAPSE_KEY = "sidebar-collapsed";

export function Sidebar({
  user,
}: {
  user: { name: string; email: string; role: "ADMIN" | "MEMBER" };
}) {
  const pathname = usePathname();
  const appName = process.env.NEXT_PUBLIC_APP_NAME || "ContractorAI";
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(() =>
    MORE_NAV.some((i) => pathname.startsWith(i.href)),
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(COLLAPSE_KEY);
    if (stored === "1") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const isChat = pathname.startsWith("/chat");
  const initial = user.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <aside
      className={cn(
        "flex h-screen shrink-0 flex-col border-r border-neutral-200 bg-white transition-[width] dark:border-neutral-800 dark:bg-neutral-900",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">
          C
        </div>
        {!collapsed && (
          <span className="flex-1 truncate font-semibold text-neutral-900 dark:text-neutral-100">
            {appName}
          </span>
        )}
        {!collapsed && <NotificationBell />}
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <nav className="space-y-1 px-2">
        {PRIMARY_NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            title={collapsed ? label : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive(href)
                ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800",
            )}
          >
            <Icon size={18} />
            {!collapsed && label}
          </Link>
        ))}

        {!collapsed && (
          <div>
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {moreOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              More
            </button>
            {moreOpen && (
              <div className="max-h-64 space-y-0.5 overflow-y-auto pl-2">
                {MORE_NAV.map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-colors",
                      isActive(href)
                        ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300"
                        : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800",
                    )}
                  >
                    <Icon size={16} />
                    {label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {user.role === "ADMIN" && (
          <Link
            href="/admin"
            title={collapsed ? "Admin" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive("/admin")
                ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800",
            )}
          >
            <Users size={18} />
            {!collapsed && "Admin"}
          </Link>
        )}
      </nav>

      {!collapsed && isChat && <SidebarConversations />}
      {(collapsed || !isChat) && <div className="flex-1" />}

      <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
        <Link
          href="/settings"
          className="mb-2 flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
            {initial}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
                {user.name}
              </div>
              <div className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                {user.role === "ADMIN" ? "Admin" : "Member"}
              </div>
            </div>
          )}
          <Settings size={16} className="shrink-0 text-neutral-400" />
        </Link>
        <form action={signOutAction}>
          <button
            type="submit"
            title={collapsed ? "Sign out" : undefined}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <LogOut size={16} />
            {!collapsed && "Sign out"}
          </button>
        </form>
      </div>
    </aside>
  );
}
