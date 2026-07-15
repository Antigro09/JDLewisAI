"use client";

import { useEffect } from "react";

/**
 * Post-sign-in handshake with the Electron shell: mints a device token
 * (POST /api/desktop/token) and hands it to the auto-updater so the update
 * proxy can apply the company's major-version entitlement. Mounted in the
 * authenticated layout, so it runs on every launch and rolls the 30-day
 * token forward — no separate refresh logic needed. No-op in browsers and
 * in shells that predate the desktop bridge.
 */
export function DesktopBridge() {
  useEffect(() => {
    const register = window.contractorAI?.desktop?.registerDeviceToken;
    if (!register) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/desktop/token", { method: "POST" });
        if (!res.ok) return;
        const { token } = (await res.json()) as { token?: string };
        if (!cancelled && token) await register(token);
      } catch {
        // Update checks simply stay unentitled for this launch.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
