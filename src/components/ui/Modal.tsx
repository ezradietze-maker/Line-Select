"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Heading } from "@/components/ui/Heading";
import { FOCUSABLE, nextStop, tabStops } from "@/lib/focus-trap";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Wider max-width for content that genuinely needs the room (e.g. two things shown side by side) — most modals stay at the default single-column width. */
  wide?: boolean;
  /**
   * Only the dialog's own button closes it: no Escape, no tap outside, no X. For a dialog whose content can't be shown
   * again once closed (a new recovery code, which has already replaced the old one on the server).
   */
  locked?: boolean;
}

/**
 * The dialogs open now, oldest first. A dialog can open over another (a key opened from inside Compare): only the top
 * one answers Escape, and the page underneath stays locked until the last one closes.
 */
const openDialogs: object[] = [];

/**
 * Whether a dialog is open over the page. A sheet that closes on Escape asks first: a dialog opened from inside it
 * (the recovery code, from the phone's More sheet) answers that Escape itself, and the sheet closing under it took the
 * dialog with it, a new recovery code and all.
 */
export const dialogOpen = () => openDialogs.length > 0;

/**
 * The control last pressed, and when. Safari doesn't focus a button it clicks, so a dialog opened by a click found
 * focus on the page's body and, closed, gave it back there; the press says which button opened it.
 */
let lastPressed: { el: HTMLElement; at: number } | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    (e) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>(FOCUSABLE) : null;
      if (el) lastPressed = { el, at: Date.now() };
    },
    true
  );
}
/** A press longer ago than this didn't open the dialog. */
const PRESS_OPENS_WITHIN_MS = 2000;

/** What can take focus in `root` now: shown, enabled, reachable by Tab, one stop per radio group. */
function focusStops(root: HTMLElement): HTMLElement[] {
  const candidates = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && !el.closest("[inert]") && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"
  );
  return tabStops(candidates, (el) => (el instanceof HTMLInputElement && el.type === "radio" && el.name ? { radioGroup: el.name, checked: el.checked } : {}));
}

/** Where focus goes back to: the opener, or when that's gone (a menu that closed), the first control near where it was. */
function returnFocus(opener: HTMLElement | null, ancestors: HTMLElement[]) {
  if (opener?.isConnected) return opener.focus();
  const near = ancestors.find((a) => a.isConnected);
  if (near) focusStops(near)[0]?.focus();
}

export function Modal({ title, onClose, children, wide = false, locked = false }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const lockedRef = useRef(locked);
  useEffect(() => {
    onCloseRef.current = onClose;
    lockedRef.current = locked;
  }, [onClose, locked]);

  useEffect(() => {
    const me = {};
    openDialogs.push(me);
    function handleKey(e: KeyboardEvent) {
      if (openDialogs[openDialogs.length - 1] !== me) return;
      if (e.key === "Escape") {
        if (!lockedRef.current) onCloseRef.current();
      }
      else if (e.key === "Tab" && !e.defaultPrevented && dialogRef.current) {
        // Round the dialog's own controls, never out to the page behind. Moved by hand, as the ⌘K palette does:
        // Safari's own Tab skips buttons and left the dialog after a few presses.
        e.preventDefault();
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        nextStop(focusStops(dialogRef.current), active, e.shiftKey)?.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      openDialogs.splice(openDialogs.indexOf(me), 1);
      if (openDialogs.length === 0) document.body.style.overflow = "";
    };
  }, []);

  // Move focus into the dialog on open, and back to whatever opened it once it closes — without this, a keyboard or
  // screen-reader user's focus silently stays on (or disappears from) the page underneath, with no indication a dialog
  // is even open. The opener is taken now, at open: the focused control, or the one just pressed when nothing is.
  useEffect(() => {
    const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const pressed = lastPressed && lastPressed.el.isConnected && Date.now() - lastPressed.at < PRESS_OPENS_WITHIN_MS ? lastPressed.el : null;
    const opener = active && !dialogRef.current?.contains(active) ? active : pressed;
    const ancestors: HTMLElement[] = [];
    // A few levels only: much further out, the "first control near it" is the top of the page.
    for (let a = opener?.parentElement ?? null; a && a !== document.body && ancestors.length < 4; a = a.parentElement) ancestors.push(a);
    dialogRef.current?.focus();
    return () => returnFocus(opener, ancestors);
  }, []);

  // Rendered at the end of <body>, not where it's used: a screen is its own layer (its entrance animation makes one),
  // and a dialog drawn inside it sat under the phone's top bar and tab bar however high its z-index.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgb(6_11_22/0.6)] px-4 py-10 sm:items-center">
      {!locked && <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 cursor-default" tabIndex={-1} />}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative w-full animate-fade-in rounded-[6px] border border-border-strong bg-surface shadow-elevated-lg outline-none ${wide ? "max-w-3xl" : "max-w-lg"}`}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <Heading as="h2" className="text-base text-ink">{title}</Heading>
          {locked ? (
            // Holds the X's room, so a dialog that locks part-way keeps its height.
            <span aria-hidden="true" className="h-7 w-7" />
          ) : (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-[3px] text-ink-faint transition-colors hover:bg-ink/[0.06] hover:text-ink"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}
