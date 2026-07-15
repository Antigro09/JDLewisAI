"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";

/**
 * Branded titlebar for the Electron shell. Rendered on every page but hidden
 * by CSS unless the preload script has marked <html> with .desktop-shell —
 * so browsers never see it and there's no hydration mismatch. The bar itself
 * is the drag region; the native min/max/close buttons are overlaid by the
 * OS (titleBarOverlay), which keeps Windows Snap Layouts working.
 *
 * It also hosts the update affordance: updates download quietly in the
 * background but never install themselves, so when one is staged a small
 * "Update" pill appears here — present but easy to ignore until the user is
 * at a good stopping point.
 */

// Hex renderings of --ember-surface / --ember-text (app/globals.css) — the
// native caption buttons can't read CSS variables. Keep in sync with
// globals.css and OVERLAY_DEFAULT in electron/main.js.
const OVERLAY = {
  light: { color: "#fffdfb", symbolColor: "#281c17" },
  dark: { color: "#261d19", symbolColor: "#f4ede8" },
} as const;

export function DesktopTitlebar() {
  const { resolvedTheme } = useTheme();
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const theme = resolvedTheme === "dark" ? "dark" : "light";
    window.contractorAI?.desktop?.setTitleBarOverlay?.(OVERLAY[theme]);
  }, [resolvedTheme]);

  useEffect(() => {
    const desktop = window.contractorAI?.desktop;
    if (!desktop?.getUpdateStatus) return;
    let cancelled = false;
    // Poll once (an update may have finished downloading before this mounted
    // or before a page reload) and subscribe for later ones.
    desktop
      .getUpdateStatus()
      .then(({ version }) => {
        if (!cancelled && version) setUpdateVersion(version);
      })
      .catch(() => {});
    const unsubscribe = desktop.onUpdateReady?.(({ version }) =>
      setUpdateVersion(version),
    );
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  // Dismiss the confirm panel on an outside click.
  useEffect(() => {
    if (!panelOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setPanelOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [panelOpen]);

  async function installUpdate() {
    setRestarting(true);
    try {
      await window.contractorAI?.desktop?.installUpdate?.();
    } catch {
      setRestarting(false);
    }
    // On success the app quits and the installer takes over — no cleanup here.
  }

  return (
    <header className="desktop-titlebar h-10 select-none items-center gap-2.5 border-b border-ember-border bg-ember-surface px-3.5">
      {/* eslint-disable-next-line @next/next/no-img-element -- 18px static asset; next/image is overkill */}
      <img
        src="/icons/icon-192.png"
        alt=""
        className="h-[18px] w-[18px] rounded-[5px]"
      />
      <span className="font-serif text-[13px] font-semibold tracking-tight text-ember-text">
        {process.env.NEXT_PUBLIC_APP_NAME || "ContractorAI"}
      </span>

      {updateVersion && (
        <div ref={panelRef} data-no-drag className="relative ml-auto">
          <button
            type="button"
            onClick={() => setPanelOpen((open) => !open)}
            title={`Version ${updateVersion} is ready to install`}
            className="flex items-center gap-1.5 rounded-full border border-ember-border px-2.5 py-[3px] text-[11px] font-medium text-ember-muted transition-colors hover:bg-ember-subtle hover:text-ember-text"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-ember-accent" />
            Update
          </button>

          {panelOpen && (
            <div className="absolute right-0 top-[30px] w-64 rounded-xl border border-ember-border bg-ember-surface p-3 shadow-ember-card">
              <p className="text-[13px] font-semibold text-ember-text">
                Version {updateVersion} is ready
              </p>
              <p className="mt-1 text-xs leading-snug text-ember-muted">
                It&apos;s already downloaded. ContractorAI will restart to
                finish installing — do it whenever suits you.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-ember-muted hover:bg-ember-subtle"
                >
                  Later
                </button>
                <button
                  type="button"
                  onClick={installUpdate}
                  disabled={restarting}
                  className="rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {restarting ? "Restarting…" : "Restart and update"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
