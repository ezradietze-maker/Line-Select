"use client";

import { ViewTransition, useLayoutEffect, useState, type ReactNode } from "react";

/**
 * Which way the pilot is moving on a route change:
 * - "forward" / "back": along the onboarding spine (upload → preferences → … → results).
 * - "down" / "up": between sidebar destinations, in rail order.
 * - "fade": anything else (an info page, a jump with no meaningful order).
 * Kept on `<html data-nav-dir>` for anything that wants it; the hand-off itself opens from the tap, whichever way.
 */
export type NavDirection = "forward" | "back" | "down" | "up" | "fade";

interface ScreenTransitionProps {
  screenKey: string;
  direction: NavDirection;
  /** Layout classes for the screen's own box (the whole screen, footer included, transitions as one). */
  className?: string;
  children: ReactNode;
}

/** Where the pilot last pressed, and when: the next page opens out from there. */
let lastPress: { x: number; y: number; at: number } | null = null;
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", (e) => (lastPress = { x: e.clientX, y: e.clientY, at: Date.now() }), true);
}
/** A press longer ago than this didn't start the route change (a link followed from the keyboard, the back button). */
const PRESS_LEADS_WITHIN_MS = 3000;

/**
 * The hand-off between screens: the outgoing screen clears, and the incoming one grows out of the point the pilot
 * tapped — the nav row, a button, a line — so the eye follows the tap into the next page (globals.css,
 * `handoff-in`). From the middle of the window when there was no tap.
 *
 * Built on React's `<ViewTransition>` (the browser's View Transitions API)
 * rather than `motion`'s `AnimatePresence`. The old screen's exit used to
 * hang or leave both screens stacked here, because a keeping-alive exit
 * animation has to hold onto a page the App Router has already replaced. A
 * view transition animates *snapshots* the browser takes of the old and new
 * screen instead, so nothing has to be kept mounted and there's no exit to
 * wait on. Browsers without the API simply swap screens instantly.
 *
 * Keyed by route, so each navigation is an exit + enter pair; updates
 * within one screen (a Suspense reveal, a deferred filter) don't animate
 * (`default="none"`). The tap point lives on `<html>` (--handoff-x / --handoff-y), which the transition's CSS reads —
 * the exiting screen's own props are from its last render, so they can't carry it.
 */
export function ScreenTransition({ screenKey, direction, className = "", children }: ScreenTransitionProps) {
  // The first screen after a load has no transition to bring it in, so it fades in on its own; every later one
  // arrives through the view transition only (fading it as well made a double fade).
  const [firstKey] = useState(screenKey);
  const [moved, setMoved] = useState(false);
  if (!moved && screenKey !== firstKey) setMoved(true);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.navDir = direction;
    const press = lastPress && Date.now() - lastPress.at < PRESS_LEADS_WITHIN_MS ? lastPress : null;
    if (press) {
      root.style.setProperty("--handoff-x", `${press.x}px`);
      root.style.setProperty("--handoff-y", `${press.y}px`);
    } else {
      root.style.removeProperty("--handoff-x");
      root.style.removeProperty("--handoff-y");
    }
  }, [screenKey, direction]);

  // A new key mounts a new <ViewTransition>, which is what has React run the route change as a view transition. The
  // screen itself isn't named ("none"): the page snapshot — just what's in the window — opens out instead
  // (globals.css). A named screen is snapshotted whole, and a page-tall image made Safari drop to ~10fps on the
  // rankings page.
  return (
    <ViewTransition key={screenKey} enter="none" exit="none" share="none" default="none">
      <div className={`${className} ${moved ? "" : "animate-fade-in"}`.trim()}>{children}</div>
    </ViewTransition>
  );
}
