import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { buildLineMonthCalendar } from "@/lib/line-month";
import { lineLengthDays } from "@/lib/metrics/line-length";
import type { BidPack, Line } from "@/types/bidpack";

/**
 * A line the way the bid pack prints it on its line pages — one strip across the whole bid period, a column a day,
 * weeks split MO–FR | SA–SU — for the results list's first look.
 *
 * The pack's own day cell, read against its pairings: every leg's flight number on the local date it departs ("D/H"
 * for a deadhead), and after a duty's last leg the city the pilot lays over in — a hub turn's city isn't printed, only
 * where they sleep; the layover city again on each whole day of the stay; the pairing number on the trip's first day,
 * its credit under it; "---" on a day off. This reads the same things from the parsed trips, so it works on every
 * stored pack, not only ones parsed after the grid's raw text was kept.
 */

/** One column of the strip's header: the date and weekday, as the pack's two header rows print them. */
export interface PackColumn {
  /** "28", "1". */
  dayOfMonth: string;
  /** "MO".."SU" — null when the pack's real dates aren't known. */
  weekday: string | null;
  weekend: boolean;
  /** A week starts here (a Monday), or the weekend does (a Saturday): where the pack draws its "|". */
  groupStart: boolean;
  /** Past the bid period's last day: shown, as the pack shows it, for trips that run on into next month. */
  beyond: boolean;
}

/** One printed word in a day's cell. */
export interface PackToken {
  text: string;
  /** A flight flown, a deadhead ("D/H"), hotel standby ("HSBY", after its hotel's city), or the city the pilot lays over in. */
  kind: "flight" | "deadhead" | "standby" | "layover";
}

/** One day of a line's strip. */
export interface PackDay {
  /** On a trip: which of the line's trips, and whether this is its first or last day on the strip. */
  trip: { index: number; start: boolean; end: boolean } | null;
  /** On a trip's first day: its pairing number and credit — the pack's "76" over "6027". */
  label: { number: string | null; creditHours: number } | null;
  /** The day's words, in order — the legs departing on it and the layover city each duty ends in. */
  tokens: PackToken[];
}

/** As many words as a day's cell has room for, as on the pack: four. */
export const PACK_TOKENS_PER_DAY = 4;

const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/**
 * How many day columns a pack's strips need: the bid period and a week past it, as the pack prints it (28 days → 35
 * columns), or more when a line's flying runs on further still (the B777's 37).
 */
export function packColumnCount(pack: Pick<BidPack, "bidPeriodStart" | "bidPeriodDays" | "base" | "lines">): number {
  const longest = pack.lines.reduce((m, l) => Math.max(m, Math.ceil(lineLengthDays(l, pack) - 1e-6)), pack.bidPeriodDays);
  return Math.max(Math.ceil(pack.bidPeriodDays / 7) * 7 + 7, longest);
}

/** The header columns: each day's date and weekday, from the bid period's first day. */
export function packColumns(bidPeriodStart: string | null, bidPeriodDays: number, count: number): PackColumn[] {
  const first = bidPeriodStart ? DateTime.fromISO(bidPeriodStart, { zone: "UTC" }) : null;
  return Array.from({ length: count }, (_, i) => {
    const day = first?.plus({ days: i });
    const weekday = day ? WEEKDAYS[day.weekday - 1] : null;
    return {
      dayOfMonth: day ? String(day.day) : String(i + 1),
      weekday,
      weekend: weekday === "SA" || weekday === "SU",
      groupStart: i > 0 && (weekday === "MO" || weekday === "SA"),
      beyond: i >= bidPeriodDays,
    };
  });
}

/** A day's words, tightened to fit: a run of deadheads says "D/H" once, and past four the middle ones go. */
function fit(tokens: PackToken[]): PackToken[] {
  const out = tokens.filter((t, i) => !(t.kind === "deadhead" && tokens[i - 1]?.kind === "deadhead"));
  return out.length > PACK_TOKENS_PER_DAY ? [...out.slice(0, PACK_TOKENS_PER_DAY - 1), out.at(-1)!] : out;
}

/** A line's strip, a day a column, `count` columns long. Without the bid period's real dates, only the trips' days and labels. */
export function buildPackRow(line: Line, bidPeriodStart: string | null, bidPeriodDays: number, count: number): PackDay[] {
  const month = buildLineMonthCalendar(line, bidPeriodStart, bidPeriodDays, "local");
  const out: PackDay[] = Array.from({ length: count }, (_, i) => {
    const day = month.days[i];
    if (!day || day.tripIndex === null || day.isOff) return { trip: null, label: null, tokens: [] };
    const trip = line.trips[day.tripIndex];
    return {
      trip: { index: day.tripIndex, start: day.isTripStart, end: day.isTripEnd },
      label: day.isTripStart ? { number: trip.pairingNumber, creditHours: trip.creditHours } : null,
      tokens: [],
    };
  });
  if (!bidPeriodStart || !month.placementIsReal) return out;

  // Each leg on the date it departs, where it departs — the pack's own calendar for its flight numbers.
  const first = DateTime.fromISO(bidPeriodStart, { zone: "UTC" });
  const dayOf = (iso: string, airport: string): number | null => {
    const at = DateTime.fromISO(iso, { zone: timezoneForAirport(airport) ?? "UTC" });
    if (!at.isValid) return null;
    return Math.round(DateTime.fromISO(at.toISODate()!, { zone: "UTC" }).diff(first, "days").days);
  };
  const raw: PackToken[][] = Array.from({ length: count }, () => []);
  const put = (d: number | null, t: PackToken) => {
    if (d !== null && d >= 0 && d < count) raw[d].push(t);
  };
  for (const trip of line.trips) {
    trip.schedule.forEach((duty, k) => {
      // Leaving a layover: its city first, where the pilot wakes up — unless the day already says it.
      const before = trip.schedule[k - 1]?.layover;
      const firstLeg = duty.legs[0];
      if (before && firstLeg) {
        const d = dayOf(firstLeg.depTimeZulu, firstLeg.depAirport);
        if (d !== null && d >= 0 && d < count && !raw[d].some((t) => t.text === before.city)) put(d, { text: before.city, kind: "layover" });
      }
      // A day of hotel standby, as the pack prints it: the hotel's city, then "HSBY".
      if (duty.legs.length > 0 && duty.legs.every((l) => l.isStandby)) {
        const d = dayOf(duty.legs[0].depTimeZulu, duty.legs[0].depAirport);
        if (!(d !== null && raw[d]?.at(-1)?.text === duty.legs[0].depAirport)) put(d, { text: duty.legs[0].depAirport, kind: "layover" });
        put(d, { text: "HSBY", kind: "standby" });
        return;
      }
      let last: number | null = null;
      for (const leg of duty.legs) {
        last = dayOf(leg.depTimeZulu, leg.depAirport);
        if (leg.isStandby) put(last, { text: "HSBY", kind: "standby" });
        else if (leg.isDeadhead || leg.equipment === "CAB") put(last, { text: "D/H", kind: "deadhead" });
        else put(last, { text: leg.flightNumber, kind: "flight" });
      }
      if (duty.layover && !(last !== null && raw[last]?.at(-1)?.text === duty.layover.city)) put(last, { text: duty.layover.city, kind: "layover" });
    });
  }
  // A whole day at a layover hotel, nothing departing: the city again, as the pack prints it each day of the stay.
  month.days.forEach((day, i) => {
    if (i >= count || raw[i].length > 0 || day.tripIndex === null || day.isOff) return;
    // The stay the day starts in, the first time through — after an eastbound date-line crossing the date also holds a second.
    const stay = [...day.segments].sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay).find((s) => s.kind === "layover" && s.stay && !s.secondPass);
    if (stay?.stay) raw[i].push({ text: stay.stay.city, kind: "layover" });
  });
  raw.forEach((tokens, i) => (out[i].tokens = fit(tokens)));
  return out;
}
