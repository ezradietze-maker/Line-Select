"use client";

import { memo, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { buildMonthGrid, monthGridSummary, type MonthGridCell } from "@/lib/month-grid";
import type { Line } from "@/types/bidpack";

/**
 * The whole bid month for one line as a plain calendar grid — trips as
 * filled days, days off as empty ones, and the city each layover starts in
 * written right on the day. Replaces an earlier version that drew a 24-hour
 * bar per day: at the size a card allows, that was 7-9px text spread over
 * ~1,100px of width inside a ~720px card, so a third of the month sat behind
 * a scroll bar in every single card. This fits any width without scrolling
 * and stays readable; the hour-by-hour chart still lives in the expanded
 * card's Calendar tab for anyone who wants it.
 */

function cellClass(cell: MonthGridCell): string {
  const base = "relative flex h-8 flex-col items-center justify-center rounded-md text-center leading-none";
  const start = cell.isTripStart ? " ring-2 ring-calendar-accent ring-offset-1 ring-offset-surface" : "";
  switch (cell.kind) {
    case "off":
      return `${base} border border-dashed border-border text-ink-faint`;
    case "layover":
      return `${base} bg-good/40 text-ink${start}`;
    case "estimated":
      return `${base} bg-brand-soft text-brand${start}`;
    default:
      return `${base} bg-calendar-accent/40 text-ink${start}`;
  }
}

function Cell({ cell }: { cell: MonthGridCell }) {
  return (
    <div className={cellClass(cell)} title={cell.title}>
      <span className={`text-[11px] tabular-nums ${cell.kind === "off" ? "" : "font-medium"}`}>{cell.label}</span>
      {cell.layoverCode && <span className="mt-0.5 text-[11px] font-semibold tracking-tight">{cell.layoverCode}</span>}
    </div>
  );
}

function LegendItem({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-3 w-3 shrink-0 rounded-sm ${swatch}`} />
      {label}
    </span>
  );
}

function MonthKeyInfo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-ink-faint underline decoration-dotted underline-offset-2 hover:text-ink"
      >
        What do these mean?
      </button>
      {open && (
        <Modal title="Month calendar key" onClose={() => setOpen(false)}>
          <ul className="space-y-3 text-sm leading-relaxed text-ink-muted">
            <li>
              <span className="font-medium text-ink">Blue day.</span> You&rsquo;re on a trip that day &mdash; flying,
              deadheading, or connecting. A ringed day is the first day of a trip.
            </li>
            <li>
              <span className="font-medium text-ink">Green day with a code.</span> The night you check into a layover
              hotel, and which city it&rsquo;s in.
            </li>
            <li>
              <span className="font-medium text-ink">Dashed empty day.</span> A day off &mdash; no duty scheduled.
            </li>
            <li>
              <span className="font-medium text-ink">Want the hours?</span> Open the card and use the Calendar tab
              for every flight, layover and ground time, hour by hour.
            </li>
          </ul>
        </Modal>
      )}
    </>
  );
}

/** The key to every month grid on the page — shown once above a list of them rather than under each one, and under each one only where a grid stands alone (the comparison view). */
export function MonthLegend({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted ${className}`}>
      <LegendItem swatch="bg-calendar-accent/40" label="Trip day" />
      <LegendItem swatch="bg-good/40" label="Layover night (city)" />
      <LegendItem swatch="border border-dashed border-border-strong" label="Day off" />
      <MonthKeyInfo />
    </div>
  );
}

interface MiniLinePreviewProps {
  line: Line;
  /** Kept for API parity with the detailed calendar's own props — the month grid doesn't need a timezone offset. */
  homeBaseOffsetMinutes?: number | null;
  bidPeriodStart: string | null;
  bidPeriodDays: number;
  /** Whether to print the legend under this grid. Default true; a list of many grids turns it off and shows one `MonthLegend` above them all. */
  showLegend?: boolean;
}

export const MiniLinePreview = memo(function MiniLinePreview({
  line,
  bidPeriodStart,
  bidPeriodDays,
  showLegend = true,
}: MiniLinePreviewProps) {
  const grid = useMemo(() => buildMonthGrid(line, bidPeriodStart, bidPeriodDays), [line, bidPeriodStart, bidPeriodDays]);

  if (line.trips.length === 0) return null;

  return (
    <div>
      <div role="group" aria-label={`Bid month at a glance. ${monthGridSummary(grid)}`}>
        {grid.weekdayHeaders && (
          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-ink-faint" aria-hidden>
            {grid.weekdayHeaders.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
        )}
        <div className="grid grid-cols-7 gap-1">
          {grid.cells.map((cell) => (
            <Cell key={cell.dayIndex} cell={cell} />
          ))}
        </div>
      </div>

      {showLegend && <MonthLegend className="mt-2" />}

      {!grid.placementIsReal && (
        <p className="mt-1.5 text-xs text-ink-faint">
          Trip lengths and total days off are exact, but this line&rsquo;s exact dates couldn&rsquo;t be confirmed, so
          trips are shown in order rather than on verified dates.
        </p>
      )}
    </div>
  );
});
