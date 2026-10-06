"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { EASE } from "@/lib/motion-tokens";

/** Per-word stagger, capped so a long question never takes more than about half a second to land. */
const WORD_STAGGER = 0.028;
const MAX_REVEAL = 0.5;

/** When the controls under a question should rise in: just after its words have. */
export function controlsDelay(title: string): number {
  return Math.min(MAX_REVEAL, title.split(/\s+/).length * WORD_STAGGER) + 0.08;
}

/**
 * Every interview question's header — a small mono eyebrow saying where you
 * are ("QUESTION 4 · DAYS OFF"), then the question itself arriving word by
 * word, the way a calm voice would say it, not printed all at once like a
 * form label. Screen readers get the whole question at once.
 */
export function QuestionPrompt({ eyebrow, title, help }: { eyebrow?: string; title: string; help?: ReactNode }) {
  const reduce = useReducedMotion();
  const words = title.split(/\s+/);
  const stagger = Math.min(WORD_STAGGER, MAX_REVEAL / Math.max(1, words.length));
  return (
    <div>
      {eyebrow && (
        <motion.div
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {eyebrow}
        </motion.div>
      )}
      <h2 aria-label={title} className="mt-2.5 font-display text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-[1.75rem]">
        {words.map((w, i) => (
          <motion.span
            key={i}
            aria-hidden
            className="inline-block"
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * stagger, duration: 0.35, ease: EASE.emphasized }}
          >
            {w}
            {i < words.length - 1 ? " " : ""}
          </motion.span>
        ))}
      </h2>
      {help && (
        <motion.div
          className="mt-2 text-sm leading-relaxed text-ink-muted"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: reduce ? 0 : Math.min(MAX_REVEAL, words.length * stagger), duration: 0.4 }}
        >
          {help}
        </motion.div>
      )}
    </div>
  );
}

/** The answer controls under a question, rising in once the question has landed. Leaf content only (no fixed-position children), so animating its transform is safe. */
export function RevealControls({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: reduce ? 0 : controlsDelay(title), duration: 0.45, ease: EASE.emphasized }}
    >
      {children}
    </motion.div>
  );
}
