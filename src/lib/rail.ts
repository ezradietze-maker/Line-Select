"use client";

import { useSyncExternalStore } from "react";
import { RAIL_KEY } from "@/lib/rail-key";

const RAIL_EVENT = "line-select:rail-change";

function isCollapsed(): boolean {
  return document.documentElement.getAttribute("data-rail") === "collapsed";
}

/**
 * Folds or opens the sidebar. The pilot's own choice is kept for their next visit; a page folding it for room (the
 * Timeline) passes `keep: false`, so a reload or a closed tab doesn't leave it folded on every page after.
 */
export function setRailCollapsed(collapsed: boolean, { keep = true }: { keep?: boolean } = {}): void {
  if (collapsed) document.documentElement.setAttribute("data-rail", "collapsed");
  else document.documentElement.removeAttribute("data-rail");
  if (keep) {
    try {
      if (collapsed) localStorage.setItem(RAIL_KEY, "collapsed");
      else localStorage.removeItem(RAIL_KEY);
    } catch {
      // Private mode or blocked storage: it still folds for this visit.
    }
  }
  window.dispatchEvent(new Event(RAIL_EVENT));
}

/** Whether the pilot folded the sidebar themselves, and it's kept that way. */
export function railFoldKept(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "collapsed";
  } catch {
    return false;
  }
}

export function useRailCollapsed(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener(RAIL_EVENT, onChange);
      return () => window.removeEventListener(RAIL_EVENT, onChange);
    },
    isCollapsed,
    () => false
  );
}
