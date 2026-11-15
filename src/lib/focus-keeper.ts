import { FOCUSABLE, focusAfterChange, tabStops } from "@/lib/focus-trap";

/** What can take focus in `root` now: shown, enabled, reachable by Tab, one stop per radio group. */
export function focusStops(root: HTMLElement): HTMLElement[] {
  const candidates = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && !el.closest("[inert]") && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"
  );
  return tabStops(candidates, (el) => (el instanceof HTMLInputElement && el.type === "radio" && el.name ? { radioGroup: el.name, checked: el.checked } : {}));
}

/**
 * Keeps the keyboard in `root` when the control it was on goes away under it: an editor's Cancel or Confirm that closed
 * the editor, an offer withdrawn, a button replaced by the form it opened, a button greyed out while it works. Left to
 * the browser, focus fell to the page and the next Tab started again at the top of it. It goes where
 * `focusAfterChange` says instead, without scrolling the page.
 *
 * Only after the keyboard was on a control in `root`, and only while nothing else has it: a press on the page around it,
 * or a dialog opened over it, lets go. A ref callback (`<div ref={keepFocusIn}>`): React runs what it returns when the
 * element goes.
 */
export function keepFocusIn(root: HTMLElement | null): (() => void) | undefined {
  if (!root) return;
  let held: { el: HTMLElement; ancestors: HTMLElement[] } | null = null;
  const onFocusIn = (e: FocusEvent) => {
    const el = e.target instanceof HTMLElement && root.contains(e.target) ? e.target : null;
    const ancestors: HTMLElement[] = [];
    // Every box out to the screen itself: when a whole section goes (the last offer withdrawn), the nearest still there.
    for (let a = el?.parentElement ?? null; a && a !== root.parentElement; a = a.parentElement) ancestors.push(a);
    held = el ? { el, ancestors } : null;
  };
  // Focus let go of a control still there and still working: the pilot clicked away from it, not something to undo.
  const onFocusOut = (e: FocusEvent) => {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    if (e.relatedTarget || !held || held.el !== el) return;
    queueMicrotask(() => {
      if (held?.el === el && el.isConnected && !(el as HTMLButtonElement).disabled) held = null;
    });
  };
  const keep = () => {
    if (!held) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const to = focusAfterChange(held, (a) => a.isConnected && root.contains(a), (a) => (a as HTMLButtonElement).disabled === true, focusStops);
    to?.focus({ preventScroll: true });
  };
  const watch = new MutationObserver(keep);
  watch.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  return () => {
    watch.disconnect();
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
  };
}
