import { useSyncExternalStore } from "react";

/**
 * Whether the pilot has put this pack's list in pay-only order (the "Pay-only month" strategy), kept on this device for
 * each pack. It's an order the pilot chose to bid, not a change to their ranking: their swaps and tiers stay as they
 * were, nothing is learned from it, and "Back to your ranking" gives the list back exactly.
 */

const KEY = "line-select:pay-order:v1:";
const CHANGED = "line-select:pay-order-changed";

function load(packId: string): boolean {
  try {
    return window.localStorage.getItem(KEY + packId) === "1";
  } catch {
    return false;
  }
}

/** The page in memory, for storage that won't keep it: the choice still holds for this visit. */
const unsaved = new Map<string, boolean>();

export function setPayOrder(packId: string, on: boolean): void {
  unsaved.set(packId, on);
  try {
    if (on) window.localStorage.setItem(KEY + packId, "1");
    else window.localStorage.removeItem(KEY + packId);
  } catch {
    // unavailable storage: kept in `unsaved` for this visit
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function isPayOrder(packId: string): boolean {
  return unsaved.get(packId) ?? load(packId);
}

function subscribe(onChange: () => void) {
  // Another tab changed it: what's stored now is the answer.
  const fromOtherTab = () => {
    unsaved.clear();
    onChange();
  };
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", fromOtherTab);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", fromOtherTab);
  };
}

export function usePayOrder(packId: string): boolean {
  return useSyncExternalStore(subscribe, () => isPayOrder(packId), () => false);
}
