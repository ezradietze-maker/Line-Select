"use client";

import { ViewTransition, useLayoutEffect, type ReactNode } from "react";

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
export function ScreenTransition({ screenKey, direction, children }: ScreenTransitionProps) {
  useLayoutEffect(() => {
    document.documentElement.dataset.navDir = direction;
  }, [screenKey, direction]);

  return (
    <ViewTransition key={screenKey} enter="panel" exit="panel" default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}
