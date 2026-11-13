/**
 * The page held still under whatever is open over it: a dialog, the ⌘K palette, the first-visit tour. Counted, so the
 * page scrolls again only when the last of them closes. Each one setting the page's overflow itself, the tour put back
 * the "hidden" it found under the palette after the palette had cleared it, and the page stayed stuck, on every screen.
 */
let holds = 0;

/** Holds the page still until the function it returns is called (once; a second call does nothing). */
export function lockScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  holds += 1;
  document.body.style.overflow = "hidden";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    if (holds === 0) document.body.style.overflow = "";
  };
}

/** Whether anything is holding the page still now. */
export const scrollLocked = (): boolean => holds > 0;

/**
 * Whether a dialog or sheet is open over the page: one that holds it still, or any marked modal (the phone's More sheet).
 * Something else that would open over the page (the tour) waits for it to close.
 */
export function overlayOpen(): boolean {
  return scrollLocked() || (typeof document !== "undefined" && document.querySelector('[aria-modal="true"]') !== null);
}
