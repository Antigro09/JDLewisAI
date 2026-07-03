"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/app/(app)/notifications/actions";

type Notif = {
  id: string;
  kind: "approval_needed" | "task_complete" | "error";
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
};

const ICONS = {
  approval_needed: Clock,
  task_complete: CheckCircle2,
  error: AlertTriangle,
};

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications ?? []);
      setUnread(data.unreadCount ?? 0);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 45_000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    // Close only on clicks outside the bell + panel. A bare document listener
    // also fires for clicks inside the panel (stopPropagation can't block it —
    // React delegates events on the document itself), which closed the panel
    // on actions like "Mark all read".
    const close = (e: Event) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    // focusin covers keyboard users: tabbing/activating outside closes too.
    document.addEventListener("mousedown", close);
    document.addEventListener("focusin", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("focusin", close);
    };
  }, [open]);

  async function onClickItem(n: Notif) {
    setOpen(false);
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      await markNotificationRead(n.id);
    }
    if (n.link) router.push(n.link);
  }

  async function onMarkAll() {
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnread(0);
    await markAllNotificationsRead();
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        className="relative rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-600 px-0.5 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 max-h-96 w-80 overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
          <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2 dark:border-neutral-700">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Notifications
            </span>
            {unread > 0 && (
              <button
                type="button"
                onClick={onMarkAll}
                className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 && (
            <p className="px-3 py-4 text-sm text-neutral-400">No notifications yet.</p>
          )}
          {items.map((n) => {
            const Icon = ICONS[n.kind];
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => onClickItem(n)}
                className={cn(
                  "flex w-full items-start gap-2 border-b border-neutral-50 px-3 py-2.5 text-left text-sm hover:bg-neutral-50 dark:border-neutral-700/50 dark:hover:bg-neutral-700/50",
                  !n.read && "bg-brand-50/50 dark:bg-brand-950/30",
                )}
              >
                <Icon
                  size={14}
                  className={cn(
                    "mt-0.5 shrink-0",
                    n.kind === "error"
                      ? "text-red-500"
                      : n.kind === "approval_needed"
                        ? "text-amber-500"
                        : "text-green-500",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-neutral-800 dark:text-neutral-100">
                    {n.title}
                  </span>
                  {n.body && (
                    <span className="mt-0.5 block truncate text-xs text-neutral-500 dark:text-neutral-400">
                      {n.body}
                    </span>
                  )}
                  <span className="mt-0.5 block text-[11px] text-neutral-400">
                    {formatDate(n.createdAt)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
