"use client";

import { motion } from "motion/react";

/**
 * The filled background of the chosen pill in a one-of-several group, sliding across to the new choice instead of
 * jumping (motion's shared layout: one `group` name per set of pills). Goes inside a `relative` button, under its
 * label, which needs its own z-10 so the pill slides under the neighbour's label on the way past, not over it; the
 * app's MotionConfig makes it jump, still, under reduced motion.
 */
export function PillHighlight({ group, className = "absolute -inset-px rounded-full bg-brand" }: { group: string; className?: string }) {
  return <motion.span layoutId={group} aria-hidden className={className} transition={{ type: "spring", stiffness: 520, damping: 40 }} />;
}
