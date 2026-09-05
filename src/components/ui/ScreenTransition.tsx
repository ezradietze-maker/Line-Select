"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

const DRIFT_PX = 24;
// Mirrors --duration-page / --ease-standard in globals.css — Motion needs a
// JS value, not a CSS custom property, so these are kept in sync by hand.
const DURATION_S = 0.32;
const EASE_STANDARD: [number, number, number, number] = [0.4, 0, 0.2, 1];

interface ScreenTransitionProps {
  screenKey: string;
  /** 1 = moving forward along the onboarding spine, -1 = moving back,
   * 0 = a lateral nav jump between unrelated screens (plain cross-fade,
   * no horizontal drift). */
  direction: 1 | -1 | 0;
  children: ReactNode;
}

/**
 * Enter-only: the incoming screen fades/drifts in on mount, the outgoing one
 * just unmounts instantly rather than getting a tracked exit animation.
 * This used to run both directions through `AnimatePresence` (coordinating
 * an exit-then-enter sequence), but that exit animation reliably failed to
 * ever report completion in this app's actual usage — verified live: every
 * screen change either hung indefinitely waiting for the old screen's exit
 * (with `mode="wait"`) or left the old and new screens permanently stacked
 * on top of each other (without it), regardless of `initial={false}`,
 * nesting, or which specific screen pair was involved. Root cause not fully
 * isolated (a `motion`/React 19 interaction is suspected, since neither
 * side's code looked wrong on its own) — flagged as a real regression worth
 * a dedicated follow-up rather than either shipping a broken transition or
 * silently declaring this fixed.
 */
export function ScreenTransition({ screenKey, direction, children }: ScreenTransitionProps) {
  const reduceMotion = useReducedMotion();
  const drift = reduceMotion ? 0 : DRIFT_PX * direction;

  return (
    <motion.div
      key={screenKey}
      initial={{ opacity: 0, x: drift }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: reduceMotion ? 0 : DURATION_S, ease: EASE_STANDARD }}
    >
      {children}
    </motion.div>
  );
}
