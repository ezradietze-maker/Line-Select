"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { useMediaQuery } from "@/lib/use-media-query";
import { DURATION, EASE } from "@/lib/motion-tokens";

const THINKING_STEPS: { afterMs: number; text: string }[] = [
  { afterMs: 0, text: "Got it — thinking about what to ask next…" },
  { afterMs: 4000, text: "Working out what matters most to you…" },
  { afterMs: 9000, text: "Still working — this one is taking a little longer than usual…" },
];

/** After that, a few lines in a pilot's voice, one every few seconds — a long wait that still visibly moves. */
const LONG_WAIT = [
  "Still working — holding short for the next question…",
  "Still working — waiting on the sort…",
  "Still working — running the checklist one more time…",
  "Almost there — taxiing in…",
];

/** A question takes several seconds to come back; a message that visibly changes reads as progress, one that never changes reads as a hang. */
function useThinkingText() {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - started), 1000);
    return () => clearInterval(id);
  }, []);
  if (elapsedMs >= 14000) return LONG_WAIT[Math.min(LONG_WAIT.length - 1, Math.floor((elapsedMs - 14000) / 5000))];
  return ([...THINKING_STEPS].reverse().find((t) => elapsedMs >= t.afterMs) ?? THINKING_STEPS[0]).text;
}

/** "Working on it": the site's loading mark, approach lights running, in a small square. Still under reduced motion. */
function Working() {
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[4px] border border-border bg-canvas/60" aria-hidden>
      <Spinner size="md" />
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
 * interview heard it — then the approach lights running while the next question is
 * worked out. Turns a dead wait into the rhythm of a conversation.
 */
export function ThinkingPanel({ lastExchange, briefing }: { lastExchange?: LastExchange | null; briefing?: string }) {
  // Read the way the server can match: motion's own hook is already true on the first render, so the HTML disagreed.
  const reduce = useMediaQuery("(prefers-reduced-motion: reduce)", false);
  const text = useThinkingText();
  return (
    <div className="flex min-h-[16rem] flex-col justify-center py-4">
      {lastExchange && (
        <motion.div
          className="mb-8 flex flex-col items-end"
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DURATION.rack, ease: EASE.rack }}
        >
          <p className="mb-1.5 max-w-[85%] truncate text-right text-xs text-ink-faint">{lastExchange.question}</p>
          <div className="max-w-[85%] rounded-[4px] border border-border border-r-[3px] border-r-accent bg-panel px-4 py-2.5 text-[15px] leading-relaxed text-ink">
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
          transition={{ duration: DURATION.rack, ease: EASE.rack }}
        >
          <div className="text-2xs text-accent font-medium">Briefing</div>
          <p className="mt-2 font-display text-xl font-semibold leading-snug text-ink">{briefing}</p>
        </motion.div>
      )}
      <div className="flex items-center gap-4">
        <Working />
        {/* The live region stays put and only its words change — one mounted already filled isn't read out. */}
        <p className="text-sm text-ink-muted" role="status" aria-live="polite">
          <motion.span key={text} className="inline-block" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
            {text}
          </motion.span>
        </p>
      </div>
    </div>
  );
}
