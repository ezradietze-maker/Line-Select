"use client";

import { useCallback, useEffect, useLayoutEffect, type RefObject } from "react";

/**
 * An answer box that grows with what's typed or dictated, up to `MAX_SHARE` of the screen, then scrolls inside — so a
 * long answer can be read back in full while the button under it stays on screen or a short scroll away. The ex-pilot,
 * filling in his answers in boxes too small to read back and with no way to dictate, typed long answers by hand.
 *
 * `following`: while dictating, words arrive at the end — keep the end, and the cursor, in view in the box and on the
 * page, so the pilot watches their words land.
 */

/** Share of the screen an answer box grows to before it scrolls inside. */
export const MAX_SHARE = 0.6;

export function useGrowingTextarea(ref: RefObject<HTMLTextAreaElement | null>, value: string, options: { minPx?: number; following?: boolean } = {}): void {
  const { minPx = 0, following = false } = options;

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const screen = window.visualViewport?.height ?? window.innerHeight;
    const max = Math.max(minPx, Math.round(screen * MAX_SHARE));
    el.style.height = "auto";
    // scrollHeight leaves out the border; the height set includes it.
    const want = Math.max(minPx, el.scrollHeight + el.offsetHeight - el.clientHeight);
    el.style.height = `${Math.min(want, max)}px`;
    el.style.overflowY = want > max ? "auto" : "hidden";
  }, [ref, minPx]);

  useLayoutEffect(fit, [fit, value]);

  // A phone keyboard opening or the window resizing changes how much of the screen there is.
  useEffect(() => {
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
    };
  }, [fit]);

  useEffect(() => {
    if (!following) return;
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    if (document.activeElement === el) el.setSelectionRange(value.length, value.length);
    el.scrollIntoView({ block: "nearest" });
  }, [ref, value, following]);
}
