"use client";

import { useSyncExternalStore } from "react";
import { RAIL_KEY } from "@/lib/rail-key";

const RAIL_EVENT = "line-select:rail-change";

function isCollapsed(): boolean {
  return document.documentElement.getAttribute("data-rail") === "collapsed";
}

export function setRailCollapsed(collapsed: boolean): void {
  if (collapsed) document.documentElement.setAttribute("data-rail", "collapsed");
  else document.documentElement.removeAttribute("data-rail");
  try {
    if (collapsed) localStorage.setItem(RAIL_KEY, "collapsed");
    else localStorage.removeItem(RAIL_KEY);
  } catch {
    // Private mode or blocked storage: it still folds for this visit.
  }
  window.dispatchEvent(new Event(RAIL_EVENT));
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
