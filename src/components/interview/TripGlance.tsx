"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { TripPicture } from "@/components/results/TripPicture";
import { CreditHours } from "@/components/results/TripMarks";
import { ChevronDownIcon } from "@/components/ui/icons";
import { useMemo } from "react";
import { carryOverWords, tripCarryInPack } from "@/lib/bid-month";
import { tripDateLabel, tripDuties, tripHeadline, tripRoute } from "@/lib/brain/line-text";
import { formatHoursValue } from "@/lib/interview-config";
import type { BidPack, Trip } from "@/types/bidpack";

/** The trip's oval — its number and credit, as the calendar marks a trip's first day — then when and how long, and its C/O. */
function TripTag({ bidPack, trip, carry }: { bidPack: Pick<BidPack, "bidPeriodStart">; trip: Trip; carry: ReturnType<typeof tripCarryInPack> }) {
  const date = tripDateLabel(bidPack, trip.startDayIndex);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
      <span className="rounded-[3px] bg-calendar-accent px-1.5 py-px font-mono text-2xs font-semibold text-on-calendar">
        {trip.pairingNumber !== null ? `#${trip.pairingNumber} ` : ""}
        <CreditHours hours={trip.creditHours} className="font-normal" />
      </span>
      <span className="font-mono">{[date, `${trip.days}-day`].filter(Boolean).join(" · ")}</span>
      {carry && <span className="font-mono text-carry">{carryOverWords(carry)}</span>}
    </span>
  );
}

/**
 * A trip as the interview shows it: the same picture as the results, one row per day — so a pilot sizes it up from
 * how it looks, as they would a trip on a trade board, with the duties as text a tap away.
 */
export function TripGlance({ bidPack, trip, tag = true, compact = true }: { bidPack: BidPack; trip: Trip; tag?: boolean; compact?: boolean }) {
  // A trip running past the bid month's end: its last days are the next month's, marked on the picture.
  const carry = useMemo(() => tripCarryInPack(bidPack, trip), [bidPack, trip]);
  return (
    <div className="min-w-0">
      {tag && <TripTag bidPack={bidPack} trip={trip} carry={carry} />}
      <div className={tag ? "mt-2" : ""}>
        <TripPicture trip={trip} bidPeriodStart={bidPack.bidPeriodStart} carryOver={carry} compact={compact} />
      </div>
      <details className="group mt-1">
        <summary className="cursor-pointer list-none text-2xs text-ink-faint marker:hidden hover:text-ink-muted">
          <span className="group-open:hidden">Show as text</span>
          <span className="hidden group-open:inline">Hide text</span>
        </summary>
        <ul className="mt-1 space-y-1 border-l-2 border-border-strong pl-2.5 font-mono text-2xs leading-relaxed text-ink-muted [overflow-wrap:anywhere]">
          {tripDuties(trip).map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** One trip of a line, folded to its headline; open, its picture. */
export function TripFold({ bidPack, trip }: { bidPack: BidPack; trip: Trip }) {
  return (
    <details className="group border-l-2 border-border-strong pl-2.5">
      <summary className="cursor-pointer list-none font-mono text-xs leading-relaxed text-ink [overflow-wrap:anywhere] marker:hidden">
        <span className="text-accent group-open:hidden" aria-hidden>
          ▸{" "}
        </span>
        <span className="hidden text-accent group-open:inline" aria-hidden>
          ▾{" "}
        </span>
        {tripHeadline(bidPack, trip, formatHoursValue)}
      </summary>
      <div className="mt-2">
        <TripGlance bidPack={bidPack} trip={trip} tag={false} />
      </div>
    </details>
  );
}

/**
 * One of two trips to choose between, the way the interview shows two lines: a full-width row with its letter, its tag
 * (number, credit, when, how long) and where it goes, tapped open to the trip day by day at full size — side by side, two pictures were too
 * squeezed to read.
 */
export function TripOptionFold({
  bidPack,
  trip,
  tag,
  label,
  selected = false,
  open,
  onToggle,
}: {
  bidPack: BidPack;
  trip: Trip;
  /** "A" or "B", on the row where a line's would be. */
  tag: string;
  /** The trip's name in the question ("the 3-day Anchorage trip"). */
  label: string;
  selected?: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const carry = useMemo(() => tripCarryInPack(bidPack, trip), [bidPack, trip]);
  return (
    <section
      className={`panel-glass overflow-hidden transition-[border-color,box-shadow] ${selected ? "!border-brand ring-1 ring-brand/40" : "hover:!border-border-strong"}`}
      aria-label={`Option ${tag}: ${label}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`Option ${tag}, ${label} — ${open ? "hide" : "show"} it day by day`}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:px-4"
      >
        <span aria-hidden className="flex h-[30px] w-10 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] border-brand font-display text-base font-extrabold text-brand">
          {tag}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-base font-semibold leading-snug text-ink">{label}</span>
          <span className="mt-0.5 block">
            <TripTag bidPack={bidPack} trip={trip} carry={carry} />
          </span>
          <span className="mt-1 block font-mono text-2xs leading-relaxed text-ink-muted [overflow-wrap:anywhere]">{tripRoute(trip)}</span>
        </span>
        <ChevronDownIcon className={`h-4 w-4 shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="trip"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-hairline"
          >
            <div className="p-3 sm:p-4">
              <TripGlance bidPack={bidPack} trip={trip} tag={false} compact={false} />
              <button type="button" onClick={onToggle} className="mt-3 inline-flex items-center gap-1 text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted">
                Close option {tag}
                <ChevronDownIcon className="h-3.5 w-3.5 rotate-180" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
