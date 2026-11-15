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
 * a switch to another window or tab, or a dialog opened over it, lets go (see `letGoWhenLeft`). A ref callback
 * (`<div ref={keepFocusIn}>`): React runs what it returns when the element goes.
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
  const stopLetGo = letGoWhenLeft(
    () => held?.el ?? null,
    () => {
      held = null;
    }
  );
  return () => {
    watch.disconnect();
    document.removeEventListener("focusin", onFocusIn);
    stopLetGo();
  };
}

/** The bits of the page `letGoWhenLeft` listens on (the document and the window; stand-ins in a test). */
type Listens = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/**
 * Lets go of the control the keyboard is kept for (`held`) once the pilot has taken the keyboard off it on purpose, so a
 * change that comes later doesn't pull focus back onto the screen from where they left it:
 * - focus let go of it while it's still there and still working: a click on the page beside it;
 * - a press anywhere but on it: a click on the page while it was greyed out and working, which moves no focus (a press
 *   on another control that takes focus is held instead, by the focus it gets);
 * - the window or tab left: the address bar, another app. Coming back puts focus back on it, which holds it again.
 * Left held, a Claim that came back "all taken" put the keyboard on "Start free month" after the pilot had clicked
 * away, and the Space they scrolled with started it. Gives back what stops listening.
 */
export function letGoWhenLeft(held: () => HTMLElement | null, letGo: () => void, doc: Listens = document, win: Listens = window): () => void {
  const onFocusOut = ((e: FocusEvent) => {
    const el = held();
    if (!el || e.target !== el || e.relatedTarget) return;
    queueMicrotask(() => {
      if (held() === el && el.isConnected && !(el as HTMLButtonElement).disabled) letGo();
    });
  }) as EventListener;
  const onPointerDown: EventListener = (e) => {
    const el = held();
    if (el && !(e.target && el.contains(e.target as Node))) letGo();
  };
  const onBlur: EventListener = (e) => {
    if (e.target === win) letGo();
  };
  doc.addEventListener("focusout", onFocusOut);
  doc.addEventListener("pointerdown", onPointerDown, true);
  win.addEventListener("blur", onBlur);
  return () => {
    doc.removeEventListener("focusout", onFocusOut);
    doc.removeEventListener("pointerdown", onPointerDown, true);
    win.removeEventListener("blur", onBlur);
  };
}
