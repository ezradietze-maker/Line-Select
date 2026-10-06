"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { DURATION, EASE } from "@/lib/motion-tokens";

const DRIFT_PX = 24;

interface StepTransitionProps {
  screenKey: string;
  /** 1 = a new step, -1 = back to an earlier one, 0 = no drift (plain fade). */
  direction: 1 | -1 | 0;
  children: ReactNode;
}

/**
 * Within one screen — the interview's question-to-question steps, which are
 * plain state changes, not route changes, so the route-level view
 * transition (`ScreenTransition`) never sees them. Enter-only: the incoming
 * step fades and drifts in on mount; the outgoing one unmounts at once.
 */
export function StepTransition({ screenKey, direction, children }: StepTransitionProps) {
  const reduceMotion = useReducedMotion();
  const drift = reduceMotion ? 0 : DRIFT_PX * direction;

  return (
    <motion.div
      key={screenKey}
      initial={{ opacity: 0, x: drift }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: reduceMotion ? 0 : DURATION.page, ease: EASE.standard }}
    >
      {children}
    </motion.div>
  );
}
