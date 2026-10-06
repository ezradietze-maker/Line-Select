"use client";

import { motion, useReducedMotion } from "motion/react";
import { NumberTicker } from "@/components/ui/NumberTicker";
import { EASE } from "@/lib/motion-tokens";

export interface LoadProgress {
  /** True once the server has the file and has started reading it. */
  received: boolean;
  pages?: { done: number; total: number };
  pairings?: number;
  lines?: number;
}

type RowState = "pending" | "active" | "done";

function StatusLight({ state }: { state: RowState }) {
  if (state === "done") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-good-soft text-good" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center" aria-hidden>
      <span
        className={`h-2 w-2 rounded-full ${
          state === "active" ? "animate-pulse bg-accent shadow-[0_0_8px_var(--glow-strong)]" : "bg-border-strong"
        }`}
      />
    </span>
  );
}

function Row({ label, state, children }: { label: string; state: RowState; children: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-3 py-2.5 transition-opacity duration-300 ${state === "pending" ? "opacity-45" : "opacity-100"}`}>
      <StatusLight state={state} />
      <span className="w-24 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">{label}</span>
      <span className="text-readout flex-1 text-right text-lg font-semibold">{children}</span>
    </div>
  );
}

/**
 * The bid pack loading like a flight plan into the box: a page under a read
 * head, and four rows that each light up as the parser genuinely reaches
 * that stage — every number is the server's own running count, streamed
 * as it works, never a timer pretending to be progress. Ends in a short
 * "LOADED" lock-in, shown only for a pack that actually parsed.
 */
export function FlightPlanLoader({ fileName, progress, loaded }: { fileName: string; progress: LoadProgress; loaded: boolean }) {
  const reduce = useReducedMotion();
  const pagesDone = progress.pages && progress.pages.done === progress.pages.total;
  const pageFraction = progress.pages ? progress.pages.done / Math.max(1, progress.pages.total) : 0;

  const uploadState: RowState = progress.received ? "done" : "active";
  const pagesState: RowState = pagesDone ? "done" : progress.received ? "active" : "pending";
  const pairingsState: RowState = progress.pairings !== undefined ? "done" : pagesDone ? "active" : "pending";
  const linesState: RowState = loaded ? "done" : progress.lines !== undefined ? "active" : "pending";

  const statusText = loaded
    ? "Flight plan loaded."
    : !progress.received
      ? "Sending your bid pack."
      : progress.lines !== undefined
        ? `Building lines: ${progress.lines}.`
        : progress.pairings !== undefined
          ? `Found ${progress.pairings} pairings.`
          : progress.pages
            ? `Reading page ${progress.pages.done} of ${progress.pages.total}.`
            : "Reading your bid pack.";

  return (
    <div className="panel-glass relative overflow-hidden p-6 sm:p-8">
      <p className="sr-only" role="status" aria-live="polite">
        {statusText}
      </p>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">Loading flight plan</div>
          <div className="mt-1 truncate font-display text-lg font-semibold text-ink">{fileName}</div>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-center">
        {/* The page under the read head, filling as pages are read. */}
        <div className="relative mx-auto h-44 w-32 shrink-0 overflow-hidden rounded-lg border border-hairline bg-surface-raised sm:mx-0" aria-hidden>
          <motion.div
            className="absolute inset-x-0 bottom-0 bg-accent-soft"
            initial={false}
            animate={{ height: `${(loaded ? 1 : pageFraction) * 100}%` }}
            transition={{ duration: reduce ? 0 : 0.4, ease: EASE.standard }}
          />
          <div className="relative space-y-2 p-3">
            {[90, 70, 84, 60, 92, 75, 66, 88, 58, 80].map((w, i) => (
              <div key={i} className="h-1 rounded-full bg-ink/15" style={{ width: `${w}%` }} />
            ))}
          </div>
          {!loaded && !reduce && (
            <motion.div
              className="absolute inset-x-0 h-8 bg-gradient-to-b from-transparent via-[var(--glow-strong)] to-transparent"
              initial={{ top: "-20%" }}
              animate={{ top: "110%" }}
              transition={{ duration: 1.6, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.2 }}
            />
          )}
        </div>

        <div className="flex-1 divide-y divide-hairline">
          <Row label="Upload" state={uploadState}>
            <span className="text-sm font-medium text-ink-muted">{progress.received ? "Received" : "Sending…"}</span>
          </Row>
          <Row label="Pages" state={pagesState}>
            {progress.pages ? (
              <>
                {progress.pages.done}
                <span className="text-ink-faint"> / {progress.pages.total}</span>
              </>
            ) : (
              <span className="text-ink-faint">&mdash;</span>
            )}
          </Row>
          <Row label="Pairings" state={pairingsState}>
            {progress.pairings !== undefined ? <NumberTicker value={progress.pairings} duration={0.8} /> : <span className="text-ink-faint">&mdash;</span>}
          </Row>
          <Row label="Lines" state={linesState}>
            {progress.lines !== undefined ? <NumberTicker value={progress.lines} duration={0.4} /> : <span className="text-ink-faint">&mdash;</span>}
          </Row>
        </div>
      </div>

      {loaded && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-panel/60 backdrop-blur-[2px]"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
        >
          <motion.div
            className="glow-soft -rotate-6 rounded-xl border-2 border-accent bg-panel px-7 py-2.5 font-mono text-2xl font-semibold uppercase tracking-[0.3em] text-accent"
            initial={reduce ? false : { scale: 1.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.35, ease: EASE.emphasized }}
          >
            Loaded
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
