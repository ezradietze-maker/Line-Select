"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BidPackHeader, BidPackStrip, StripKey, stripLayout } from "@/components/results/BidPackStrip";
import { useMeasuredWidth } from "@/components/results/LegBars";
import { buildPackRow, packColumnCount, packColumns } from "@/lib/bidpack-row";
import { buildLineTimeline } from "@/lib/line-timeline";
import { baseDayStartMinutes, zoneOf } from "@/lib/phase-in";
import { SAMPLE_BID_PACK, sampleLineFlying } from "@/lib/sample-bidpack";
import { useTextScale } from "@/lib/use-text-scale";
import type { LineVacationMark } from "@/lib/vacation-marks";

/**
 * The landing page's vacation, on a line the way the rankings draw it: the results list's own strip in its Bid pack view
 * (the line as the pack prints it, the tidier picture at a glance), from the sample pack's made-up trips. The pack has the vacation on September 11–17, over days the
 * line already has off; slid two days earlier it takes off the trip on the 9th, and the line has twelve days off together.
 */
const LINE = sampleLineFlying("2033", [
  ["501", 1],
  ["503", 4],
  ["502", 10],
  ["503", 19],
  ["501", 24],
]);
const PACK = { ...SAMPLE_BID_PACK, lines: [LINE] };
const COLUMNS = packColumns(PACK.bidPeriodStart, PACK.bidPeriodDays, packColumnCount(PACK));
const TIMELINE = buildLineTimeline(LINE, PACK, COLUMNS.length);
const DAYS = buildPackRow(LINE, PACK.bidPeriodStart, PACK.bidPeriodDays, COLUMNS.length);

const DAY_START = baseDayStartMinutes(zoneOf(PACK));
const dayAt = (d: number) => DAY_START + d * 1440;
const VACATION = { from: 10, awardedFrom: 12, days: 7 };
const MARK: LineVacationMark = {
  pieces: [
    {
      id: "landing-vacation",
      start: dayAt(VACATION.from),
      end: dayAt(VACATION.from + VACATION.days),
      awardedStart: dayAt(VACATION.awardedFrom),
      awardedEnd: dayAt(VACATION.awardedFrom + VACATION.days),
      firstDay: VACATION.from,
      lastDay: VACATION.from + VACATION.days - 1,
      awardedFirstDay: VACATION.awardedFrom,
      awardedLastDay: VACATION.awardedFrom + VACATION.days - 1,
      days: VACATION.days,
      earlier: 3,
      later: 2,
    },
  ],
  removedStarts: TIMELINE.trips.filter((t) => t.start >= dayAt(VACATION.from) && t.start < dayAt(VACATION.from + VACATION.days)).map((t) => t.start),
  removedDays: [VACATION.from],
  freeWindows: [],
};

export function VacationLinePicture() {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>(1000);
  const textScale = useTextScale();
  const layout = useMemo(() => stripLayout(width, COLUMNS.length, textScale), [width, textScale]);
  const [open, setOpen] = useState(false);
  // On a phone the days scroll sideways, as they do in the rankings: started at the vacation, not at the month's first
  // day with the vacation off the screen.
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const days = card.current?.querySelector<HTMLElement>("[role=region]");
    if (layout.mode === "scroll" && days) days.scrollLeft = (layout.daysPx / COLUMNS.length) * (VACATION.from - 3);
  }, [layout]);
  return (
    <div ref={ref} className="min-w-0">
      <BidPackHeader columns={COLUMNS} layout={layout} label="Satisfaction Index · # · line" sticky={false} />
      <div ref={card} className="panel-glass overflow-hidden" data-landing-vacation-line>
        <BidPackStrip line={LINE} score={97.4} capped={false} columns={COLUMNS} view={{ kind: "pack", days: DAYS }} layout={layout} grip={null} open={open} onToggle={() => setOpen((o) => !o)} top rank={1} vacation={MARK} />
        {open && (
          <p className="border-t border-hairline px-4 py-3 text-sm text-ink-muted">
            Slid 2 days earlier than the pack has it, your vacation takes off trip 502 on the 9th, paid from your bank, and
            line 2033 has 12 days off together.
          </p>
        )}
      </div>
      <StripKey view="pack" vacation hint="Tap the line for what it changed." className="mt-3" />
    </div>
  );
}
