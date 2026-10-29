"use client";

import { useMemo, useState, type ReactNode } from "react";
import { largestShape, LegBars, rowShape, useMeasuredWidth } from "@/components/results/LegBars";
import { Zone } from "@/components/results/TripMarks";
import { ChevronDownIcon } from "@/components/ui/icons";
import { displayHotelName } from "@/lib/hotels/hotel-names";
import { labeledStayPieces, layoverHours } from "@/lib/leg-bars";
import { dateLabel, tripDayDate } from "@/lib/trip-day-stats";
import { buildHomeDays, buildTimelineDays, type TimeMode, type TimelineDay, type TimelineSegment } from "@/lib/trip-timeline";
import type { Trip } from "@/types/bidpack";
import type { CityMark } from "@/types/preferences";

/**
 * A trip the way the month calendar draws its days, one row per day and bigger: each leg a bold line with a tick at
 * each end, to scale and placed by the time of day, midnight at the left and midnight at the right — blue flown,
 * magenta deadheaded — its times over its ends, its cities and flight number under it. Each layover is a green line
 * under the flying with the hotel van (GT) a cyan mark at each end, apart from the line, and "L/O OAK 28h" and the hotel on it. Every day
 * stands the same height. Beside each day, when its duty starts: "Rpt" on the trip's first, "P/U" — the hotel pickup
 * — after a layover. The rows are the base's own calendar days, on the base's clock — so a trip's days line up with
 * the calendar's and every bar is as long as the flight — while every time printed is local where it happens, as the
 * bid pack prints it (or Zulu, with the toggle).
 *
 * With `dayDetail`, each day opens on a tap to everything the pairing says about it (see `TripDayDetail`).
 */

interface TripPictureProps {
  trip: Trip;
  mode?: TimeMode;
  bidPeriodStart: string | null;
  cityPreferences?: Record<string, CityMark>;
  /** Interview cards: fewer hour marks, no hotel names. */
  compact?: boolean;
  /** Everything about one day, shown under it when it's tapped open. */
  dayDetail?: (day: TimelineDay) => ReactNode;
}

/** The days the rows show: the base's calendar on the local clock, Zulu days on Zulu. */
export function tripPictureDays(trip: Trip, mode: TimeMode): TimelineDay[] {
  return mode === "zulu" ? buildTimelineDays(trip, "zulu") : buildHomeDays(trip, "local");
}

/**
 * When a duty starts on this day, and how: the trip's first duty reports ("Rpt"); every later one starts at the hotel
 * pickup ("P/U"), the van from the layover hotel — not the same thing, and the pilot plans around which it is.
 */
export function dutyStartOf(day: TimelineDay): { kind: "report" | "pickup"; clock: string } | null {
  // A duty starts on this day when its first piece is here: nothing of it carried over from the night before. Its
  // layover (the stay after it) doesn't count as part of the duty's start.
  const duties = new Set(day.segments.map((s) => s.dutyIndex).filter((d): d is number => d !== undefined));
  let first: TimelineSegment | null = null;
  for (const d of duties) {
    const pieces = day.segments.filter((s) => s.dutyIndex === d && s.kind !== "layover" && s.kind !== "sleep");
    if (pieces.length === 0 || pieces.some((s) => s.continuesFromPreviousDay)) continue;
    const earliest = pieces.reduce((a, s) => (s.startMinuteOfDay < a.startMinuteOfDay ? s : a));
    if (!first || earliest.startMinuteOfDay < first.startMinuteOfDay) first = earliest;
  }
  if (!first?.startClock) return null;
  return { kind: (first.dutyIndex ?? 0) > 0 ? "pickup" : "report", clock: first.startClock };
}

export function TripPicture({ trip, mode = "local", bidPeriodStart, cityPreferences, compact = false, dayDetail }: TripPictureProps) {
  const days = useMemo(() => tripPictureDays(trip, mode), [trip, mode]);
  const labeled = useMemo(() => labeledStayPieces(days.map((d) => d.segments)), [days]);
  const [trackRef, width] = useMeasuredWidth<HTMLDivElement>(compact ? 240 : 520);
  const shape = useMemo(() => largestShape(days.map((d) => rowShape(d.segments, width))), [days, width]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  if (days.length === 0) return null;
  const base = trip.schedule[0]?.legs[0]?.depAirport;
  const hours = compact ? [0, 6, 12, 18, 24] : [0, 3, 6, 9, 12, 15, 18, 21, 24];
  const grid = compact ? "grid-cols-[3.5rem_minmax(0,1fr)]" : "grid-cols-[4.25rem_minmax(0,1fr)]";
  const allOpen = open.size === days.length;
  const toggle = (n: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  return (
    <div className="min-w-0">
      {dayDetail && (
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] text-ink-faint">Tap a day for everything the pairing says about it.</span>
          <button
            type="button"
            onClick={() => setOpen(allOpen ? new Set() : new Set(days.map((d) => d.dayNumber)))}
            className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-ink-muted hover:text-ink"
            aria-expanded={allOpen}
          >
            {allOpen ? "Close every day" : "Open every day"}
            <ChevronDownIcon className={`h-2.5 w-2.5 transition-transform ${allOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      )}
      <div className={`grid ${grid} items-end gap-x-2`} aria-hidden>
        <span className="whitespace-nowrap font-mono text-[10px] text-ink-faint">{mode === "zulu" ? "Zulu" : base ? `${base} time` : ""}</span>
        <div ref={trackRef} className="relative h-3.5">
          {hours.map((h) => (
            <span
              key={h}
              className={`absolute top-0 font-mono text-[10px] leading-none text-ink-faint ${h === 0 ? "" : h === 24 ? "-translate-x-full" : "-translate-x-1/2"}`}
              style={{ left: `${(h / 24) * 100}%` }}
            >
              {String(h % 24).padStart(2, "0")}
            </span>
          ))}
        </div>
      </div>
      <ol className="mt-0.5">
        {days.map((day) => {
          const date = mode === "local" ? (day.date ? dateLabel(day.date) : tripDayDate(trip, bidPeriodStart, day.dayNumber)) : null;
          const start = dutyStartOf(day);
          const isOpen = open.has(day.dayNumber);
          const row = (
            <>
              <span className="flex min-w-0 flex-col items-start leading-tight">
                <span className="flex items-center gap-1 truncate text-[11px] font-semibold text-ink">
                  {date ? `${date.weekday} ${date.day}` : `Day ${day.dayNumber}`}
                  {dayDetail && <ChevronDownIcon className={`h-2.5 w-2.5 shrink-0 text-ink-faint transition-transform ${isOpen ? "rotate-180" : ""}`} />}
                </span>
                {start && (
                  <span className={`truncate font-mono text-[10px] font-semibold ${start.kind === "report" ? "text-report" : "text-gt"}`} title={start.kind === "report" ? "Report" : "Hotel pickup — the van from the layover hotel"}>
                    {start.kind === "report" ? "Rpt" : "P/U"} {start.clock}
                    <Zone mode={mode} />
                  </span>
                )}
              </span>
              <LegBars
                segments={day.segments}
                widthPx={width}
                shape={shape}
                stayLabeled={(s) => labeled.has(s)}
                cityPreferences={cityPreferences}
                formatStay={({ city, hours: h, hotel }, mark) => (
                  <>
                    <span className="font-normal">L/O </span>
                    {city}
                    <span className="font-normal"> {layoverHours(h)}</span>
                    {mark}
                    {!compact && hotel && <span className="font-sans font-normal capitalize text-ink-muted"> · {displayHotelName(hotel).toLowerCase()}</span>}
                  </>
                )}
              />
            </>
          );
          return (
            <li key={day.dayNumber} className="border-t border-hairline first:border-t-0">
              {dayDetail ? (
                <button
                  type="button"
                  onClick={() => toggle(day.dayNumber)}
                  aria-expanded={isOpen}
                  aria-label={`${date ? `${date.weekday} ${date.day}` : `Day ${day.dayNumber}`} — ${isOpen ? "hide" : "show"} everything on this day`}
                  className={`grid w-full ${grid} items-center gap-x-2 rounded-md py-1 text-left transition-colors hover:bg-calendar-accent/[0.05] ${isOpen ? "bg-calendar-accent/[0.05]" : ""}`}
                >
                  {row}
                </button>
              ) : (
                <div className={`grid ${grid} items-center gap-x-2 py-1`}>{row}</div>
              )}
              {dayDetail && isOpen && <div className="pb-2 pt-0.5">{dayDetail(day)}</div>}
            </li>
          );
        })}
      </ol>
      {!compact && (
        <p className="mt-1 text-[10.5px] leading-snug text-ink-faint">
          {mode === "zulu" ? "Bars and times in Zulu." : `Bars on ${base ?? "the base"}'s clock, as long as each flight; times are local where they happen, as the bid pack prints them.`}
        </p>
      )}
    </div>
  );
}
