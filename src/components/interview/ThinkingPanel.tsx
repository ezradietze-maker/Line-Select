"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { EASE } from "@/lib/motion-tokens";

const THINKING_STEPS: { afterMs: number; text: string }[] = [
  { afterMs: 0, text: "Got it — thinking about what to ask next…" },
  { afterMs: 4000, text: "Working out what matters most to you…" },
  { afterMs: 9000, text: "Still working — this one is taking a little longer than usual…" },
];

/** A question takes several seconds to come back; a message that visibly changes reads as progress, one that never changes reads as a hang. */
function useThinkingText() {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - started), 1000);
    return () => clearInterval(id);
  }, []);
  return ([...THINKING_STEPS].reverse().find((t) => elapsedMs >= t.afterMs) ?? THINKING_STEPS[0]).text;
}

/** A small radar scope sweeping — the instrument for "working on it". Static under reduced motion. */
function RadarSweep() {
  const reduce = useReducedMotion();
  return (
    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full border border-hairline bg-canvas/60" aria-hidden>
      <div className="absolute inset-[22%] rounded-full border border-hairline" />
      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-hairline" />
      <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-hairline" />
      <div
        className={`absolute inset-0 rounded-full ${reduce ? "" : "animate-[spin_2.4s_linear_infinite]"}`}
        style={{ background: "conic-gradient(from 0deg, transparent 0deg, transparent 280deg, var(--glow-strong) 350deg, var(--color-accent) 360deg)" }}
      />
      <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_8px_var(--glow-strong)]" />
    </div>
  );
}

export interface LastExchange {
  question: string;
  answer: string;
  elaboration?: string;
}

/**
 * Between questions: what the pilot just said, said back to them — the
 * interview heard it — then the scope sweeping while the next question is
 * worked out. Turns a dead wait into the rhythm of a conversation.
 */
export function ThinkingPanel({ lastExchange, briefing }: { lastExchange?: LastExchange | null; briefing?: string }) {
  const reduce = useReducedMotion();
  const text = useThinkingText();
  return (
    <div className="flex min-h-[16rem] flex-col justify-center py-4">
      {lastExchange && (
        <motion.div
          className="mb-8 flex flex-col items-end"
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE.emphasized }}
        >
          <p className="mb-1.5 max-w-[85%] truncate text-right text-xs text-ink-faint">{lastExchange.question}</p>
          <div className="max-w-[85%] rounded-2xl rounded-br-md border border-accent/30 bg-accent-soft/70 px-4 py-2.5 text-[15px] leading-relaxed text-ink">
            {lastExchange.answer}
            {lastExchange.elaboration && <span className="mt-1 block text-sm italic text-ink-muted">&ldquo;{lastExchange.elaboration}&rdquo;</span>}
          </div>
        </motion.div>
      )}
      {!lastExchange && briefing && (
        <motion.div
          className="mb-8"
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE.emphasized }}
        >
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">Briefing</div>
          <p className="mt-2 font-display text-xl font-semibold leading-snug text-ink">{briefing}</p>
        </motion.div>
      )}
      <div className="flex items-center gap-4">
        <RadarSweep />
        <motion.p
          key={text}
          className="text-sm text-ink-muted"
          role="status"
          aria-live="polite"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          {text}
        </motion.p>
      </div>
    </div>
  );
}
