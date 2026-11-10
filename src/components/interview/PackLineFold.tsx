"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo, type ReactNode } from "react";
import { TripFold } from "@/components/interview/TripGlance";
import { BidPackStrip, type StripLayout } from "@/components/results/BidPackStrip";
import { MiniLinePreview } from "@/components/results/MiniLinePreview";
import { ChevronDownIcon } from "@/components/ui/icons";
import { buildPackRow, type PackColumn } from "@/lib/bidpack-row";
import { lineFigures } from "@/lib/brain/line-text";
import type { BidPack } from "@/types/bidpack";

/**
 * One line in the interview, the way the results list shows it: the bid pack's own strip, on the same day columns as
 * any other line shown with it, and tapped open, the full month calendar and its trips one by one — big enough for a
 * pilot to read. Every line the interview shows is drawn this way, whether it's one of two to choose between or an
 * example under a question.
 */
export function PackLineFold({
  bidPack,
  lineNumber,
  tag,
  heading,
  note,
  columns,
  layout,
  selected = false,
  open,
  onToggle,
}: {
  bidPack: BidPack;
  lineNumber: string;
  /** A letter on the strip where a score would be ("A", "B"); none for an example. */
  tag?: string;
  /** Over the line's name when it's open: "Option A", "#4 on your list". */
  heading?: string;
  /** Above the strip: what the question shows this line for, and its figure. */
  note?: ReactNode;
  columns: PackColumn[];
  layout: StripLayout;
  selected?: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const line = bidPack.lines.find((l) => l.lineNumber === lineNumber);
  const days = useMemo(() => (line ? buildPackRow(line, bidPack.bidPeriodStart, bidPack.bidPeriodDays, columns.length) : []), [line, bidPack, columns.length]);
  if (!line) return null;
  return (
    <section
      className={`panel-glass overflow-hidden transition-[border-color,box-shadow] ${selected ? "!border-brand ring-1 ring-brand/40" : "hover:!border-border-strong"}`}
      aria-label={tag ? `Option ${tag}: line ${lineNumber}` : `Line ${lineNumber}`}
    >
      {note ? <div className="border-b border-hairline px-4 py-2 text-sm">{note}</div> : null}
      <BidPackStrip line={line} score={null} tag={tag} capped={false} columns={columns} view={{ kind: "pack", days }} layout={layout} grip={null} open={open} onToggle={onToggle} />
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="calendar"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-hairline"
          >
            <div className="p-4 sm:p-5">
              {heading ? <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">{heading}</p> : null}
              <p className="mt-0.5 font-display text-xl font-semibold text-ink">Line {lineNumber}</p>
              <p className="mb-3 font-mono text-xs text-ink-muted">{lineFigures(bidPack, line)}</p>
              <MiniLinePreview line={line} bidPeriodStart={bidPack.bidPeriodStart} bidPeriodDays={bidPack.bidPeriodDays} />
              <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">Its trips</p>
              <ul className="mt-2 space-y-2">
                {/* The same pairing can be flown twice in a month, so its id alone isn't a unique key. */}
                {line.trips.map((t, i) => (
                  <li key={`${t.id}-${i}`}>
                    <TripFold bidPack={bidPack} trip={t} />
                  </li>
                ))}
              </ul>
              <button type="button" onClick={onToggle} className="mt-4 inline-flex items-center gap-1 text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted">
                Close line {lineNumber}&rsquo;s calendar
                <ChevronDownIcon className="h-3.5 w-3.5 rotate-180" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
