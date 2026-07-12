"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EngineJobStatus, TakeoffStatus } from "@/lib/db/schema";

export type TakeoffStatusPayload = {
  status: TakeoffStatus;
  jobStatus?: EngineJobStatus | null;
  progress?: string;
  error?: string | null;
  engineDown?: boolean;
  stalled?: boolean;
};

const TERMINAL = new Set<TakeoffStatus>(["indexed", "review", "failed"]);

function forwardStatus(current: TakeoffStatus | undefined, next: TakeoffStatus): TakeoffStatus {
  if ((current === "review" || current === "failed") && next === "processing") return current;
  if ((current === "review" || current === "failed") && (next === "created" || next === "uploading")) {
    return current;
  }
  if (current === "indexed" && (next === "created" || next === "uploading" || next === "indexing")) {
    return current;
  }
  return next;
}

function resetStatus(current: TakeoffStatus | undefined, next: TakeoffStatus): TakeoffStatus {
  if ((current === "review" || current === "failed") && (next === "created" || next === "uploading")) {
    return current;
  }
  if (current === "indexed" && (next === "created" || next === "uploading" || next === "indexing")) {
    return current;
  }
  return next;
}

export function useTakeoffJob(
  takeoffId: string | null,
  opts: {
    enabled: boolean;
    initialStatus?: TakeoffStatus;
    onReview?: () => void;
  },
) {
  const [snapshot, setSnapshot] = useState<TakeoffStatusPayload>({
    status: opts.initialStatus ?? "created",
  });
  const tokenRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const backoffRef = useRef(1000);
  const controllerRef = useRef<AbortController | null>(null);
  const onReviewRef = useRef(opts.onReview);
  const takeoffIdRef = useRef<string | null>(takeoffId);
  onReviewRef.current = opts.onReview;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    if (!takeoffId || inFlightRef.current) return;
    const token = tokenRef.current;
    inFlightRef.current = true;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const response = await fetch(`/api/takeoff/${takeoffId}/status`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = (await response.json()) as TakeoffStatusPayload;
      if (token !== tokenRef.current) return;
      setSnapshot((current) => ({
        ...data,
        status: forwardStatus(current.status, data.status),
      }));
      if (data.engineDown) {
        backoffRef.current = Math.min(backoffRef.current * 2, 5000);
      } else {
        backoffRef.current = data.status === "processing" ? 1000 : 2000;
      }
      if (data.status === "review") onReviewRef.current?.();
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        backoffRef.current = Math.min(backoffRef.current * 2, 5000);
        setSnapshot((current) => ({ ...current, engineDown: true }));
      }
    } finally {
      inFlightRef.current = false;
      if (token === tokenRef.current) {
        setSnapshot((current) => {
          if (!opts.enabled || TERMINAL.has(current.status)) return current;
          clearTimer();
          timerRef.current = window.setTimeout(poll, backoffRef.current);
          return current;
        });
      }
    }
  }, [clearTimer, opts.enabled, takeoffId]);

  useEffect(() => {
    const nextStatus = opts.initialStatus ?? "created";
    const isNewTakeoff = takeoffIdRef.current !== takeoffId;
    takeoffIdRef.current = takeoffId;
    tokenRef.current += 1;
    clearTimer();
    controllerRef.current?.abort();
    backoffRef.current = 1000;
    inFlightRef.current = false;
    setSnapshot((current) => ({
      status: isNewTakeoff ? nextStatus : resetStatus(current.status, nextStatus),
    }));

    if (takeoffId && opts.enabled) {
      timerRef.current = window.setTimeout(poll, 250);
    }

    return () => {
      tokenRef.current += 1;
      clearTimer();
      controllerRef.current?.abort();
    };
  }, [clearTimer, opts.enabled, opts.initialStatus, poll, takeoffId]);

  const refresh = useCallback(() => {
    clearTimer();
    void poll();
  }, [clearTimer, poll]);

  return { snapshot, refresh };
}
