"use client";

import { useCallback, useEffect, useLayoutEffect, type RefObject } from "react";

/**
 * An answer box that grows with what's typed or dictated, up to `MAX_SHARE` of the screen, then scrolls inside — so a
 * long answer can be read back in full while the button under it stays on screen or a short scroll away. The ex-pilot,
 * filling in his answers in boxes too small to read back and with no way to dictate, typed long answers by hand.
 *
 * `following`: while dictating, words arrive at the end — keep the end, and the cursor, in view in the box and on the
 * page, so the pilot watches their words land.
 *
 * `maxShare: null`: never scroll inside — the box grows as long as the answer and the page is the one scroll, for a
 * box meant to hold a page of writing (the bidding story), where a scroll box inside a scrolling page fights the pilot.
 */

/** Share of the screen an answer box grows to before it scrolls inside. */
export const MAX_SHARE = 0.6;

export function useGrowingTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  options: { minPx?: number; following?: boolean; maxShare?: number | null } = {},
): void {
  const { minPx = 0, following = false, maxShare = MAX_SHARE } = options;

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const screen = window.visualViewport?.height ?? window.innerHeight;
    const max = maxShare === null ? Infinity : Math.max(minPx, Math.round(screen * maxShare));
    // Measuring collapses the box for a moment, which shortens the page and pulls it back up when the pilot has
    // scrolled down past it — hold both scroll positions and put them back.
    const pageY = window.scrollY;
    const inside = el.scrollTop;
    const was = el.offsetHeight;
    el.style.height = "auto";
    // scrollHeight leaves out the border; the height set includes it.
    const want = Math.max(minPx, el.scrollHeight + el.offsetHeight - el.clientHeight);
    el.style.height = `${Math.min(want, max)}px`;
    el.style.overflowY = want > max ? "auto" : "hidden";
    el.scrollTop = inside;
    if (window.scrollY !== pageY) window.scrollTo(window.scrollX, pageY);
    // Writing at the end of a box that just grew past the bottom of the screen (or under the phone's tab bar): keep
    // the end, where the cursor is, in view.
    if (el.offsetHeight > was && document.activeElement === el && el.selectionEnd === el.value.length) {
      const under = parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom) || 0;
      if (el.getBoundingClientRect().bottom > window.innerHeight - under) el.scrollIntoView({ block: "end" });
    }
  }, [ref, minPx, maxShare]);

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
    // A box taller than the screen: bring its end into view, where the words are landing.
    const box = el.getBoundingClientRect();
    const screen = window.visualViewport?.height ?? window.innerHeight;
    if (box.top < 0 || box.bottom > screen) el.scrollIntoView({ block: box.height > screen ? "end" : "nearest" });
  }, [ref, value, following]);
}
