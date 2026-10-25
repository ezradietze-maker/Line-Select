"use client";

import { useMemo } from "react";
import { LegBars, stayHours, useMeasuredWidth } from "@/components/results/LegBars";
import { displayHotelName } from "@/lib/hotels/hotel-names";
import { labeledStayPieces } from "@/lib/leg-bars";
import { dateLabel, dayStats, tripDayDate } from "@/lib/trip-day-stats";
import { buildHomeDays, buildTimelineDays, type TimeMode, type TimelineDay } from "@/lib/trip-timeline";
import type { Trip } from "@/types/bidpack";
import type { CityMark } from "@/types/preferences";

/**
 * A trip the way the month calendar draws its days, one row per day and bigger: each leg a line with a tick at each
 * end, to scale and placed by the time of day, midnight at the left and midnight at the right, the cities under its
 * ends and its times over them. The hotel stay is a quiet line with the city and how long on it, the time on duty a
 * faint band under the flying. The rows are the base's own calendar days, on the
 * base's clock — so a trip's days line up with the calendar's and every bar is as long as the flight — while every time
 * printed is local where it happens, as the bid pack prints it (or Zulu, with the toggle).
 */

interface TripPictureProps {
  trip: Trip;
  mode?: TimeMode;
  bidPeriodStart: string | null;
  cityPreferences?: Record<string, CityMark>;
  /** Interview cards: fewer hour marks, no hotel names. */
  compact?: boolean;
  /** The surface it's drawn on, behind the layover words. */
  labelBg?: string;
}

/** The days the rows show: the base's calendar on the local clock, Zulu days on Zulu. */
export function tripPictureDays(trip: Trip, mode: TimeMode): TimelineDay[] {
  return mode === "zulu" ? buildTimelineDays(trip, "zulu") : buildHomeDays(trip, "local");
}

export function TripPicture({ trip, mode = "local", bidPeriodStart, cityPreferences, compact = false, labelBg = "bg-surface" }: TripPictureProps) {
  const days = useMemo(() => tripPictureDays(trip, mode), [trip, mode]);
  const labeled = useMemo(() => labeledStayPieces(days.map((d) => d.segments)), [days]);
  const [trackRef, width] = useMeasuredWidth<HTMLDivElement>(compact ? 240 : 520);
  if (days.length === 0) return null;
  const base = trip.schedule[0]?.legs[0]?.depAirport;
  const hours = compact ? [0, 6, 12, 18, 24] : [0, 3, 6, 9, 12, 15, 18, 21, 24];
  const grid = compact ? "grid-cols-[3.5rem_minmax(0,1fr)]" : "grid-cols-[4rem_minmax(0,1fr)]";

  return (
    <div className="min-w-0">
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
          const st = dayStats(day);
          return (
            <li key={day.dayNumber} className={`grid ${grid} items-center gap-x-2 border-t border-hairline py-1 first:border-t-0`}>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-[11px] font-semibold text-ink">{date ? `${date.weekday} ${date.day}` : `Day ${day.dayNumber}`}</span>
                {st.onDuty && <span className="truncate font-mono text-[10px] text-ink-muted">Rpt {st.onDuty}</span>}
              </span>
              <LegBars
                segments={day.segments}
                variant="row"
                widthPx={width}
                times
                stays
                stayLabeled={(s) => labeled.has(s)}
                cityPreferences={cityPreferences}
                labelBg={labelBg}
                minLabelWidth={0}
                formatStay={({ city, hours: h, hotel }, mark) => (
                  <>
                    {city} {stayHours(h)}
                    {mark}
                    {!compact && hotel && <span className="font-sans font-normal capitalize text-ink-muted"> · {displayHotelName(hotel).toLowerCase()}</span>}
                  </>
                )}
              />
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
