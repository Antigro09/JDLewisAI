"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  MessageSquare,
  FolderKanban,
  Workflow,
  AudioLines,
  Sparkles,
  Settings,
  Users,
  LogOut,
  Search,
  Sun,
  Moon,
  Menu,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/app/(auth)/actions";
import { SidebarConversations } from "@/components/sidebar-conversations";
import { NotificationBell } from "@/components/notification-bell";
import { CommandPalette } from "@/components/command-palette";

const PRIMARY_NAV = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/meetings", label: "Meetings", icon: AudioLines },
  { href: "/automations", label: "Automations", icon: Workflow },
  { href: "/customize", label: "Customize", icon: Sparkles },
];

export function Sidebar({
  user,
}: {
  user: { name: string; email: string; role: "SUPERADMIN" | "ADMIN" | "MEMBER" };
}) {
  const pathname = usePathname();
  const appName = process.env.NEXT_PUBLIC_APP_NAME || "ContractorAI";
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [themeSpin, setThemeSpin] = useState(0);

  useEffect(() => setMounted(true), []);
  useEffect(() => setMobileOpen(false), [pathname]);

  const dark = mounted && resolvedTheme === "dark";
  function toggleTheme() {
    setTheme(dark ? "light" : "dark");
    setThemeSpin((n) => n + 1);
  }

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const isChat = pathname.startsWith("/chat");
  const initial = user.name.trim().charAt(0).toUpperCase() || "?";

  const navRow = (
    href: string,
    label: string,
    Icon: LucideIcon,
    active: boolean,
  ) => (
    <Link
      key={href}
      href={href}
      className={cn(
        "group flex items-center gap-3 rounded-[14px] px-[13px] py-[9px] text-sm transition-colors duration-200",
        active
          ? "bg-ember-tint font-semibold text-ember-tint-text"
          : "font-medium text-ember-muted hover:bg-ember-subtle",
      )}
    >
      <Icon
        size={19}
        className={cn(
          "shrink-0 transition-transform duration-200 ease-ember-spring",
          !active && "group-hover:-rotate-6 group-hover:scale-110",
        )}
      />
      {label}
    </Link>
  );

  return (
    <>
      {/* Mobile top bar */}
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-ember-border bg-ember-surface/80 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="rounded-lg p-1.5 text-ember-muted transition-colors hover:bg-ember-subtle"
        >
          <Menu size={20} />
        </button>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-ember-accent-solid font-serif font-bold text-white">
          C
        </span>
        <span className="flex-1 truncate font-semibold text-ember-text">
          {appName}
        </span>
        <NotificationBell />
      </header>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-dvh w-[264px] shrink-0 -translate-x-full flex-col border-r border-ember-border bg-ember-surface transition-transform duration-300 ease-ember-drawer",
          "lg:static lg:z-auto lg:w-[248px] lg:translate-x-0",
          mobileOpen && "translate-x-0",
        )}
      >
        {/* Logo row */}
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-ember-accent-solid font-serif text-[17px] font-bold text-white">
            C
          </span>
          <span className="flex-1 truncate text-[16px] font-semibold text-ember-text">
            {appName}
          </span>
          <NotificationBell />
          <button
            type="button"
            onClick={toggleTheme}
            title="Toggle theme"
            aria-label="Toggle theme"
            className="flex shrink-0 rounded-full bg-ember-pill p-[7px] text-ember-faint transition-colors hover:text-ember-muted"
          >
            <span
              key={themeSpin}
              style={{
                animation:
                  themeSpin > 0
                    ? "emb-bounce-pop .45s cubic-bezier(0.34,1.56,0.64,1)"
                    : undefined,
                display: "flex",
              }}
            >
              {dark ? <Sun size={15} /> : <Moon size={15} />}
            </span>
          </button>
        </div>

        {/* Find a tool… — opens the command palette */}
        <div className="px-2 pb-1">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex w-full items-center gap-2 rounded-full border border-ember-border bg-ember-subtle/60 px-3.5 py-2 text-sm text-ember-faint transition-colors hover:bg-ember-subtle"
          >
            <Search size={16} className="shrink-0" />
            <span className="flex-1 text-left">Find a tool…</span>
            <kbd className="rounded-md border border-ember-border px-1.5 py-0.5 text-[10.5px] font-medium">
              ⌘K
            </kbd>
          </button>
        </div>

        <nav className="space-y-1 px-2 pt-1">
          {PRIMARY_NAV.map(({ href, label, icon }) =>
            navRow(href, label, icon, isActive(href)),
          )}
        </nav>

        {isChat ? <SidebarConversations /> : <div className="flex-1" />}

        {/* Secondary group */}
        <nav className="space-y-1 border-t border-ember-border px-2 pt-2">
          {user.role === "SUPERADMIN" &&
            navRow("/owner", "Owner console", Users, isActive("/owner"))}
          {(user.role === "ADMIN" || user.role === "SUPERADMIN") &&
            navRow("/admin", "Admin", Users, isActive("/admin"))}
          {navRow("/settings", "Settings", Settings, isActive("/settings"))}
        </nav>

        {/* User footer */}
        <div className="p-3">
          <div className="flex items-center gap-2 rounded-[14px] bg-ember-subtle/50 px-1.5 py-1.5">
            <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-ember-tint text-[13px] font-semibold text-ember-tint-text">
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ember-text">
                {user.name}
              </div>
              <div className="truncate text-xs text-ember-faint">
                {user.role === "SUPERADMIN"
                  ? "Owner"
                  : user.role === "ADMIN"
                    ? "Admin"
                    : "Member"}
              </div>
            </div>
            <form action={signOutAction} className="shrink-0">
              <button
                type="submit"
                title="Sign out"
                aria-label="Sign out"
                className="flex rounded-lg p-1.5 text-ember-faint transition-colors hover:bg-ember-subtle hover:text-ember-danger"
              >
                <LogOut size={16} />
              </button>
            </form>
          </div>
          <div className="mt-1.5 flex justify-center gap-3 text-[11px] text-ember-faint">
            <Link href="/legal/terms" className="hover:underline">
              Terms
            </Link>
            <Link href="/legal/privacy" className="hover:underline">
              Privacy
            </Link>
          </div>
        </div>
      </aside>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
