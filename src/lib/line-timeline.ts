import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import type { BidPack, Line } from "@/types/bidpack";

/**
 * A whole line's month as one continuous timeline on the base's clock — the results list's newer strip, beside the
 * bid pack's own (`lib/bidpack-row.ts`). Every report-to-release, flight, deadhead, standby and layover sits at its
 * real time, in minutes from the bid period's first midnight at base, so a strip can draw the month to scale: when a
 * duty starts and how long it runs, how long each layover is, how the days off fall — with every flight number, city,
 * trip number and credit the pack prints still on it.
 */

const DAY = 24 * 60;

export interface TimelineSpan {
  start: number;
  end: number;
}

export interface TimelineTrip extends TimelineSpan {
  index: number;
  number: string | null;
  creditHours: number;
  /** The trip's length in days, as the pairing prints it. */
  days: number;
}

export interface TimelineLeg extends TimelineSpan {
  flight: string;
  from: string;
  to: string;
  kind: "flight" | "deadhead" | "standby";
}

export interface TimelineStay extends TimelineSpan {
  city: string;
  hours: number;
}

/** A run of days off: its first day and how many. */
export interface OffRun {
  day: number;
  length: number;
}

export interface LineTimeline {
  trips: TimelineTrip[];
  /** Each duty, report to its last landing. */
  duties: TimelineSpan[];
  legs: TimelineLeg[];
  stays: TimelineStay[];
  offRuns: OffRun[];
}

const EMPTY: LineTimeline = { trips: [], duties: [], legs: [], stays: [], offRuns: [] };

/** The line's timeline, `days` days long from the bid period's first day. Empty without the pack's real dates. */
export function buildLineTimeline(line: Line, pack: Pick<BidPack, "bidPeriodStart" | "bidPeriodDays" | "base">, days: number): LineTimeline {
  if (!pack.bidPeriodStart || line.estimated) return EMPTY;
  const zone = timezoneForAirport(pack.base) ?? "UTC";
  const origin = DateTime.fromISO(pack.bidPeriodStart, { zone }).toMillis();
  if (!Number.isFinite(origin)) return EMPTY;
  const at = (iso: string) => (Date.parse(iso) - origin) / 60_000;
  const fromAnchor = (anchor: string, minutes: number) => (Date.parse(anchor) - origin) / 60_000 + minutes;

  const out: LineTimeline = { trips: [], duties: [], legs: [], stays: [], offRuns: [] };
  line.trips.forEach((trip, index) => {
    if (!trip.zuluAnchor || trip.schedule.length === 0) return;
    let tripStart = Infinity;
    let tripEnd = -Infinity;
    trip.schedule.forEach((duty) => {
      const legs = duty.legs.filter((l) => l.depTimeZulu && l.arrTimeZulu);
      if (legs.length === 0) return;
      const report = Math.min(fromAnchor(trip.zuluAnchor, duty.startMinutes), at(legs[0].depTimeZulu));
      const release = at(legs.at(-1)!.arrTimeZulu);
      out.duties.push({ start: report, end: release });
      tripStart = Math.min(tripStart, report);
      tripEnd = Math.max(tripEnd, release);
      for (const l of legs) {
        out.legs.push({
          start: at(l.depTimeZulu),
          end: at(l.arrTimeZulu),
          flight: l.isStandby ? "HSBY" : l.isDeadhead || l.equipment === "CAB" ? "D/H" : l.flightNumber,
          from: l.depAirport,
          to: l.arrAirport,
          kind: l.isStandby ? "standby" : l.isDeadhead || l.equipment === "CAB" ? "deadhead" : "flight",
        });
      }
      if (duty.layover) {
        const start = fromAnchor(trip.zuluAnchor, duty.layover.startMinutes);
        out.stays.push({ start, end: fromAnchor(trip.zuluAnchor, duty.layover.endMinutes), city: duty.layover.city, hours: duty.layover.hours });
      }
    });
    if (Number.isFinite(tripStart)) out.trips.push({ index, number: trip.pairingNumber, creditHours: trip.creditHours, days: trip.days, start: tripStart, end: tripEnd });
  });
  out.trips.sort((a, b) => a.start - b.start);

  // Days off: the pack's own "---" days when it printed them, else the days no trip touches.
  const off = new Set<number>();
  if (line.gridOffDays) for (const d of line.gridOffDays) off.add(d);
  else
    for (let d = 0; d < pack.bidPeriodDays; d++) {
      const touched = out.trips.some((t) => t.start < (d + 1) * DAY && t.end > d * DAY);
      if (!touched) off.add(d);
    }
  for (let d = 0; d < Math.min(days, pack.bidPeriodDays); d++) {
    if (!off.has(d)) continue;
    const last = out.offRuns.at(-1);
    if (last && last.day + last.length === d) last.length++;
    else out.offRuns.push({ day: d, length: 1 });
  }
  return out;
}
