"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageSquare,
  FolderKanban,
  FileText,
  Receipt,
  Map,
  ShieldAlert,
  Settings,
  Users,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/app/(auth)/actions";

const NAV = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/scopes", label: "Scopes of Work", icon: FileText },
  { href: "/invoices", label: "Invoices", icon: Receipt },
  { href: "/plans", label: "Plan Reader", icon: Map },
  { href: "/eap", label: "Emergency Plan", icon: ShieldAlert },
];

export function Sidebar({
  user,
}: {
  user: { name: string; email: string; role: "ADMIN" | "MEMBER" };
}) {
  const pathname = usePathname();
  const appName = process.env.NEXT_PUBLIC_APP_NAME || "ContractorAI";

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">
          C
        </div>
        <span className="font-semibold text-neutral-900">{appName}</span>
      </div>

      <nav className="flex-1 space-y-1 px-2">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive(href)
                ? "bg-brand-50 text-brand-700"
                : "text-neutral-600 hover:bg-neutral-100",
            )}
          >
            <Icon size={18} />
            {label}
          </Link>
        ))}

        <div className="my-2 border-t border-neutral-200" />

        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            isActive("/settings")
              ? "bg-brand-50 text-brand-700"
              : "text-neutral-600 hover:bg-neutral-100",
          )}
        >
          <Settings size={18} />
          Settings
        </Link>

        {user.role === "ADMIN" && (
          <Link
            href="/admin"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive("/admin")
                ? "bg-brand-50 text-brand-700"
                : "text-neutral-600 hover:bg-neutral-100",
            )}
          >
            <Users size={18} />
            Admin
          </Link>
        )}
      </nav>

      <div className="border-t border-neutral-200 p-3">
        <div className="mb-2 px-1">
          <div className="truncate text-sm font-medium text-neutral-800">
            {user.name}
          </div>
          <div className="truncate text-xs text-neutral-500">{user.email}</div>
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
