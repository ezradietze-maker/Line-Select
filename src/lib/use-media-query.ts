"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches right now, kept live. For layout that
 * genuinely has to differ in markup rather than just styling — e.g. where a
 * single drag handle (which can only be one element) is placed. The server
 * render assumes the wider layout (`serverDefault`).
 */
export function useMediaQuery(query: string, serverDefault = true): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverDefault
  );
}
