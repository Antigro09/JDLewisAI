"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { cn, truncate } from "@/lib/utils";
import {
  deleteConversation,
  renameConversation,
  toggleConversationPinned,
} from "@/app/(app)/chat/actions";

type ConvItem = { id: string; title: string; pinned: boolean };

export function SidebarConversations() {
  const pathname = usePathname();
  const router = useRouter();
  const [items, setItems] = useState<ConvItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.conversations ?? []);
    } catch {
      // sidebar list is non-critical — fail silently
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    if (!menuId) return;
    // Close only on clicks outside the row menus. A bare document listener
    // also fires for the "⋯" toggle and menu items (stopPropagation can't
    // block it — React delegates events on the document itself), which
    // clobbered the toggle so switching between row menus took two clicks.
    const close = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.("[data-conv-menu]")) return;
      setMenuId(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuId]);

  if (!loaded) return null;

  const pinned = items.filter((c) => c.pinned);
  const recent = items.filter((c) => !c.pinned);

  async function onRename(id: string) {
    const title = editValue.trim();
    setEditingId(null);
    if (!title) return;
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    await renameConversation(id, title);
  }

  async function onTogglePin(c: ConvItem) {
    setMenuId(null);
    setItems((prev) =>
      prev.map((x) => (x.id === c.id ? { ...x, pinned: !c.pinned } : x)),
    );
    await toggleConversationPinned(c.id, !c.pinned);
  }

  async function onDelete(c: ConvItem) {
    setMenuId(null);
    if (!window.confirm(`Delete "${c.title}"?`)) return;
    setItems((prev) => prev.filter((x) => x.id !== c.id));
    await deleteConversation(c.id);
    if (pathname === `/chat/${c.id}`) router.push("/chat");
  }

  function Row({ c }: { c: ConvItem }) {
    const active = pathname === `/chat/${c.id}`;
    const isEditing = editingId === c.id;
    return (
      <div className="group relative">
        {isEditing ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => onRename(c.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRename(c.id);
              if (e.key === "Escape") setEditingId(null);
            }}
            className="w-full rounded-lg border border-brand-300 bg-white px-3 py-1.5 text-sm outline-none dark:border-brand-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        ) : (
          <Link
            href={`/chat/${c.id}`}
            className={cn(
              "flex items-center justify-between rounded-lg px-3 py-1.5 text-sm transition-colors",
              active
                ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800",
            )}
          >
            <span className="truncate">{truncate(c.title, 28)}</span>
            <button
              type="button"
              data-conv-menu
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuId(menuId === c.id ? null : c.id);
              }}
              className="ml-1 shrink-0 rounded p-0.5 text-neutral-400 opacity-0 hover:bg-neutral-200 group-hover:opacity-100 dark:hover:bg-neutral-700"
            >
              <MoreHorizontal size={14} />
            </button>
          </Link>
        )}
        {menuId === c.id && (
          <div
            data-conv-menu
            className="absolute right-0 top-full z-20 mt-1 w-36 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
          >
            <button
              type="button"
              onClick={() => {
                setEditValue(c.title);
                setEditingId(c.id);
                setMenuId(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              <Pencil size={13} /> Rename
            </button>
            <button
              type="button"
              onClick={() => onTogglePin(c)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              {c.pinned ? <PinOff size={13} /> : <Pin size={13} />}
              {c.pinned ? "Unpin" : "Pin"}
            </button>
            <button
              type="button"
              onClick={() => onDelete(c)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
            >
              <Trash2 size={13} /> Delete
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      {pinned.length > 0 && (
        <div className="mb-2">
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            Pinned
          </p>
          <div className="space-y-0.5">
            {pinned.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          Recents
        </p>
        <div className="space-y-0.5">
          {recent.length === 0 && pinned.length === 0 && (
            <p className="px-3 py-2 text-sm text-neutral-400">No conversations yet.</p>
          )}
          {recent.map((c) => (
            <Row key={c.id} c={c} />
          ))}
        </div>
      </div>
    </div>
  );
}
