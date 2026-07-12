import type { EngineQuantity } from "@/lib/takeoff-engine/types";

/** Same threshold the bulk "Accept high-confidence" action has always used. */
export const HIGH_CONFIDENCE_THRESHOLD = 0.85;

export const AUTO_ACCEPT_STORAGE_KEY = "material-takeoff.autoAcceptHighConfidence";

type SettingStore = Pick<Storage, "getItem" | "setItem">;

export function isHighConfidence(quantity: EngineQuantity): boolean {
  return (quantity.final_confidence ?? 0) >= HIGH_CONFIDENCE_THRESHOLD;
}

/** Defaults to OFF: only an explicit stored "true" enables auto-accept. */
export function readAutoAcceptSetting(store: SettingStore | null | undefined): boolean {
  try {
    return store?.getItem(AUTO_ACCEPT_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeAutoAcceptSetting(store: SettingStore | null | undefined, enabled: boolean): void {
  try {
    store?.setItem(AUTO_ACCEPT_STORAGE_KEY, String(enabled));
  } catch {
    // Storage can be unavailable (private mode / quota); the toggle still works for the session.
  }
}

/**
 * Picks the next quantity to auto-accept, or null when there is nothing to do.
 * Items are accepted one at a time (the caller re-runs after each accept
 * settles), and `dispatched` keeps a failed accept from looping forever.
 */
export function nextAutoAcceptTarget(
  enabled: boolean,
  quantities: EngineQuantity[],
  dispatched: ReadonlySet<string>,
): EngineQuantity | null {
  if (!enabled) return null;
  return quantities.find((q) => isHighConfidence(q) && !dispatched.has(q.id)) ?? null;
}
