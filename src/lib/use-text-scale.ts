"use client";

import { useSyncExternalStore } from "react";

/**
 * How much bigger than the usual 16px the pilot's browser sets its text (Chrome's font size, Android's text scaling):
 * 2 at 200%. Never below 1. For layout worked out in px beside words set in rem — at 200% text the words doubled and
 * the px they were given didn't, and they ran over each other. The server render assumes 1.
 */
export function useTextScale(): number {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("resize", onChange);
      return () => window.removeEventListener("resize", onChange);
    },
    () => textScaleOf(parseFloat(getComputedStyle(document.documentElement).fontSize)),
    () => 1
  );
}

/** The root's font size, px → how many times 16px it is, from 1 up. */
export function textScaleOf(rootPx: number): number {
  return Number.isFinite(rootPx) && rootPx > 16 ? rootPx / 16 : 1;
}
