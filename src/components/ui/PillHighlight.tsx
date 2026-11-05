"use client";

import { motion } from "motion/react";

/**
 * The filled background of the chosen pill in a one-of-several group, sliding across to the new choice instead of
 * jumping (motion's shared layout: one `group` name per set of pills). Goes inside a `relative` button, under its
 * label; the app's MotionConfig makes it jump, still, under reduced motion.
 */
export function PillHighlight({ group }: { group: string }) {
  return <motion.span layoutId={group} aria-hidden className="absolute -inset-px rounded-full bg-brand" transition={{ type: "spring", stiffness: 520, damping: 40 }} />;
}
