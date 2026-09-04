"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
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

export function ScreenTransition({ screenKey, direction, children }: ScreenTransitionProps) {
  const reduceMotion = useReducedMotion();
  const drift = reduceMotion ? 0 : DRIFT_PX * direction;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={screenKey}
        initial={{ opacity: 0, x: drift }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -drift }}
        transition={{ duration: reduceMotion ? 0 : DURATION_S, ease: EASE_STANDARD }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
