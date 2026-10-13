"use client";

import { ViewTransition, useLayoutEffect, useState, type ReactNode } from "react";

/**
 * Which way the panels move on a route change:
 * - "forward" / "back": along the onboarding spine (upload → preferences → … → results) — sideways.
 * - "down" / "up": between sidebar destinations, in rail order — the panel
 *   stack moves vertically on a desktop, sideways under the phone's tab bar.
 * - "fade": anything else (an info page, a jump with no meaningful order).
 */
export type NavDirection = "forward" | "back" | "down" | "up" | "fade";

interface ScreenTransitionProps {
  screenKey: string;
  direction: NavDirection;
  /** Layout classes for the screen's own box (the whole screen, footer included, transitions as one). */
  className?: string;
  children: ReactNode;
}

/**
 * The "panel slide" between screens: the outgoing screen slides out and
 * fades while the incoming one slides in behind it, from the direction
 * the pilot is moving.
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
 * (`default="none"`). The direction lives on `<html data-nav-dir>`, which
 * the transition's CSS in globals.css reads — the exiting screen's own
 * props are from its last render, so they can't carry the new direction.
 */
export function ScreenTransition({ screenKey, direction, className = "", children }: ScreenTransitionProps) {
  // The first screen after a load has no transition to bring it in, so it fades in on its own; every later one
  // arrives through the view transition only (fading it as well made a double fade).
  const [firstKey] = useState(screenKey);
  const [moved, setMoved] = useState(false);
  if (!moved && screenKey !== firstKey) setMoved(true);

  useLayoutEffect(() => {
    document.documentElement.dataset.navDir = direction;
  }, [screenKey, direction]);

  // A new key mounts a new <ViewTransition>, which is what has React run the route change as a view transition. The
  // screen itself isn't named ("none"): the page snapshot — just what's in the window — fades instead (globals.css).
  // A named screen is snapshotted whole, and a page-tall image made Safari drop to ~10fps on the rankings page.
  return (
    <ViewTransition key={screenKey} enter="none" exit="none" share="none" default="none">
      <div className={`${className} ${moved ? "" : "animate-fade-in"}`.trim()}>{children}</div>
    </ViewTransition>
  );
}
