"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Global desktop meeting auto-start. Runs in the Electron shell: starts the
 * detection loop and, when a meeting is detected, auto-starts recording (consent
 * is covered by the employee agreement — no prompt) and routes into the live
 * workspace. Deduped so the 5s detection loop fires once per call. In a plain
 * browser (no desktop bridge) this is a no-op.
 */
export function MeetingAutoStart() {
  const router = useRouter();
  const startingRef = useRef(false);
  const lastKeyRef = useRef<string | null>(null);
  const cooldownUntilRef = useRef(0);

  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.contractorAI?.meetings : undefined;
    if (!bridge?.onDetected) return;

    bridge.startDetection?.().catch(() => {});

    const off = bridge.onDetected(async (raw) => {
      const payload = (raw ?? {}) as { app?: string; confidence?: number };
      const app = String(payload.app ?? "meeting");
      const now = Date.now();
      // Debounce: one attempt per detected app per cooldown window.
      if (startingRef.current) return;
      if (lastKeyRef.current === app && now < cooldownUntilRef.current) return;
      startingRef.current = true;
      lastKeyRef.current = app;
      cooldownUntilRef.current = now + 6 * 60 * 60 * 1000;

      try {
        const res = await fetch("/api/meetings/auto-start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            detectedApp: app,
            detectionConfidence: Number(payload.confidence ?? 0),
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          meetingId?: string;
          created?: boolean;
        };
        if (res.ok && json.meetingId && json.created) {
          router.push(`/meetings/${json.meetingId}?autostart=1`);
        }
      } catch {
        // best-effort; detection will fire again
        cooldownUntilRef.current = 0;
      } finally {
        startingRef.current = false;
      }
    });

    return () => off?.();
  }, [router]);

  return null;
}
