"use client";

import { useEffect, useState } from "react";

/**
 * How many of `target` items to actually mount right now: the first `step`
 * straight away, then another `step` each time the browser is idle, until
 * all `target` are in. A long list of heavy cards (each with a calendar,
 * a gauge, banners) then paints its top within one short task instead of
 * blocking a phone's main thread for a second or more before anything shows.
 * A `target` that shrinks takes effect at once; one that grows fills in the
 * same way.
 */
export function useProgressiveCount(target: number, step = 6): number {
  const [count, setCount] = useState(() => Math.min(step, target));

  useEffect(() => {
    if (count >= target) return;
    const next = () => setCount((c) => Math.min(c + step, target));
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(next, { timeout: 200 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(next, 16);
    return () => window.clearTimeout(id);
  }, [count, target, step]);

  return Math.min(count, target);
}
