"use client";

import { useEffect, useState } from "react";

/** Comfortably past the end of a page transition (110ms out + 260ms in, globals.css, after the new screen renders). */
const SETTLE_MS = 700;

/**
 * How many of `target` items to actually mount right now: the first `first`
 * (by default `step`) straight away, then another `step` each time the browser is idle, until
 * all `target` are in. A long list of heavy cards (each with a calendar,
 * a gauge, banners) then paints its top within one short task instead of
 * blocking a phone's main thread for a second or more before anything shows.
 * A `target` that shrinks takes effect at once; one that grows fills in the
 * same way.
 */
export function useProgressiveCount(target: number, step = 6, first = step): number {
  const [count, setCount] = useState(() => Math.min(first, target));

  useEffect(() => {
    if (count >= target) return;
    const next = () => setCount((c) => Math.min(c + step, target));
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(next, { timeout: 200 });
      return () => window.cancelIdleCallback(id);
    }
    // No idle callback (Safari): the first top-up waits out the page transition — cards past the first batch are below
    // the fold anyway, and mounting them mid-fade dropped Safari to ~15fps — then the rest follow a frame apart.
    const id = window.setTimeout(next, count <= first ? SETTLE_MS : 16);
    return () => window.clearTimeout(id);
  }, [count, target, step, first]);

  return Math.min(count, target);
}
