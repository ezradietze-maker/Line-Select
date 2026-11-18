import { useSyncExternalStore } from "react";
import type { StrategyId } from "@/types/strategy";

/** What the Strategies page can show: the vacation slide tool, or one strategy. */
export type StrategyMenuId = "vacation" | StrategyId;

export interface StrategyMenuItem {
  id: StrategyMenuId;
  /** Short enough for the sidebar. */
  label: string;
  /** The strategy's full name, as its card heads it: the sidebar's tooltip and what a screen reader says. */
  name: string;
}

/**
 * Every strategy, in the order the sidebar lists them: the vacation slide tool first, then the moves. The same list
 * whatever the month: one that doesn't apply to this pack says so on the page, rather than the sidebar changing under
 * the pilot from month to month.
 */
export const STRATEGY_MENU: StrategyMenuItem[] = [
  { id: "vacation", label: "Vacation slide", name: "Vacation slide — test it on each line" },
  { id: "true-number", label: "Your real number", name: "Your real number this month" },
  { id: "leftovers", label: "Lines seniors leave", name: "Bid the lines senior pilots leave behind" },
  { id: "secondary-play", label: "Aim for a secondary", name: "Aim for a secondary line" },
  { id: "reserve-pays-more", label: "When reserve pays more", name: "When reserve pays more than a line" },
  { id: "vacation-overlap", label: "Vacation under big trips", name: "Put your vacation under a line's biggest trips" },
  { id: "carry-over", label: "Credit into next month", name: "Start next month with credit in the bank" },
  { id: "pay-only", label: "Pay-only month", name: "Bid a pay-only month" },
  { id: "sweep-flights", label: "Trips that get rerouted", name: "Know which trips can be rerouted" },
  { id: "after-award", label: "After the award", name: "Work every window after the award" },
];

/** What the page shows with nothing picked: the slide tool, as it always has. */
export const DEFAULT_STRATEGY: StrategyMenuId = "vacation";

/** The strategy an address points at (`/strategies#leftovers`), or the default for none or one this list doesn't know. */
export function strategyFromHash(hash: string): StrategyMenuId {
  let id = hash.replace(/^#/, "");
  try {
    id = decodeURIComponent(id);
  } catch {
    // a malformed address is just an unknown one
  }
  return STRATEGY_MENU.some((item) => item.id === id) ? (id as StrategyMenuId) : DEFAULT_STRATEGY;
}

/** Told to the page when the pilot picks a strategy on it, from the sidebar or the phone's picker. */
const CHANGED = "line-select:strategy-changed";

/**
 * Shows a strategy on the Strategies page already open: its own address, so Back returns to the one before and a reload
 * keeps it. (From another page, the app navigates to `/strategies#id` instead.)
 */
export function openStrategy(id: StrategyMenuId): void {
  if (strategyFromHash(window.location.hash) === id && window.location.hash) return;
  window.history.pushState(null, "", `#${id}`);
  window.dispatchEvent(new Event(CHANGED));
}

function subscribeStrategy(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

/** The strategy the address shows. The server can't see the #fragment: it, and the first paint, draw the default. */
export function useStrategyId(): StrategyMenuId {
  return useSyncExternalStore(subscribeStrategy, () => strategyFromHash(window.location.hash), () => DEFAULT_STRATEGY);
}

// ---- Whether the sidebar's list is unfolded ----

const OPEN_KEY = "line-select:strategies-menu:v1";
const OPEN_CHANGED = "line-select:strategies-menu-changed";

/** The pilot's own choice, or null when they haven't made one: then the list follows the page (open on Strategies). */
export type MenuOpenChoice = "open" | "closed" | null;

export function readMenuOpen(raw: string | null): MenuOpenChoice {
  return raw === "open" || raw === "closed" ? raw : null;
}

function loadMenuOpen(): MenuOpenChoice {
  try {
    return readMenuOpen(window.localStorage.getItem(OPEN_KEY));
  } catch {
    return null;
  }
}

export function saveMenuOpen(choice: "open" | "closed"): void {
  try {
    window.localStorage.setItem(OPEN_KEY, choice);
  } catch {
    // ignore — unavailable storage; the list still unfolds for this visit
  }
  window.dispatchEvent(new Event(OPEN_CHANGED));
}

function subscribeMenuOpen(onChange: () => void): () => void {
  window.addEventListener(OPEN_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(OPEN_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Unfolded when the pilot said so, or, with no choice made, whenever they're on Strategies. */
export function menuIsOpen(choice: MenuOpenChoice, onStrategies: boolean): boolean {
  return choice === null ? onStrategies : choice === "open";
}

export function useStrategiesMenuOpen(onStrategies: boolean): [boolean, (open: boolean) => void] {
  const choice = useSyncExternalStore(subscribeMenuOpen, loadMenuOpen, () => null);
  return [menuIsOpen(choice, onStrategies), (open: boolean) => saveMenuOpen(open ? "open" : "closed")];
}
