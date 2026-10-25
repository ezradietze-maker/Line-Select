"use client";

import { TripPicture } from "@/components/results/TripPicture";
import { tripDateLabel, tripDuties, tripHeadline } from "@/lib/brain/line-text";
import { hm } from "@/lib/trip-day-stats";
import type { BidPack, Trip } from "@/types/bidpack";

/** The trip's oval — its number and credit, as the calendar marks a trip's first day — then when and how long. */
function TripTag({ bidPack, trip }: { bidPack: Pick<BidPack, "bidPeriodStart">; trip: Trip }) {
  const date = tripDateLabel(bidPack, trip.startDayIndex);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
      <span className="rounded-full bg-calendar-accent px-1.5 py-px font-mono text-[11px] font-semibold text-on-calendar">
        {trip.pairingNumber !== null ? `#${trip.pairingNumber} ` : ""}
        <span className="font-normal opacity-85">{hm(trip.creditHours * 60)}</span>
      </span>
      <span className="font-mono">{[date, `${trip.days}-day`].filter(Boolean).join(" · ")}</span>
    </span>
  );
}

/**
 * A trip as the interview shows it: the same picture as the results, one row per day — so a pilot sizes it up from
 * how it looks, as they would a trip on a trade board, with the duties as text a tap away.
 */
export function TripGlance({ bidPack, trip, labelBg = "bg-surface", tag = true }: { bidPack: BidPack; trip: Trip; labelBg?: string; tag?: boolean }) {
  return (
    <div className="min-w-0">
      {tag && <TripTag bidPack={bidPack} trip={trip} />}
      <div className={tag ? "mt-2" : ""}>
        <TripPicture trip={trip} bidPeriodStart={bidPack.bidPeriodStart} compact labelBg={labelBg} />
      </div>
      <details className="group mt-1">
        <summary className="cursor-pointer list-none text-[11px] text-ink-faint marker:hidden hover:text-ink-muted">
          <span className="group-open:hidden">Show as text</span>
          <span className="hidden group-open:inline">Hide text</span>
        </summary>
        <ul className="mt-1 space-y-1 border-l-2 border-border-strong pl-2.5 font-mono text-[11px] leading-relaxed text-ink-muted [overflow-wrap:anywhere]">
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
        {tripHeadline(bidPack, trip)}
      </summary>
      <div className="mt-2">
        <TripGlance bidPack={bidPack} trip={trip} tag={false} />
      </div>
    </details>
  );
}
