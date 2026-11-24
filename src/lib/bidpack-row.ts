import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { buildLineMonthCalendar } from "@/lib/line-month";
import { lineLengthDays } from "@/lib/metrics/line-length";
import { standbyPlace } from "@/lib/standby";
import { isInternationalCity } from "@/lib/pdf-parser/airports";
import { lineByDay, tripReleaseHours } from "@/lib/trip-anchor";
import type { BidPack, Line, TripLeg } from "@/types/bidpack";

/**
 * A line the way the bid pack prints it on its line pages — one strip across the whole bid period, a column a day,
 * weeks split MO–FR | SA–SU — for the results list's first look.
 *
 * The pack's own day cell, read against its pairings. A cell is four rows, a quarter of the local day each. A duty
 * starts in the row its report falls in (`reportLead`: an hour before a flight) — so a flight leaving at 0042 is the
 * last row of the day before. Each leg after it takes the next row down ("D/H" for a deadhead), and after the duty's last leg the city the pilot lays over in — a hub turn's city isn't printed, only
 * where they sleep. Past a day's fourth row it runs on into the next day's first: B767 MEM trip 76's 0036, out of
 * Frankfurt at 2235 on Oct 8 after 5233 and 5034, is printed on the 9th. A row already taken keeps what it has: a
 * trip's first flight is lost under the trip before's run-over, and a duty's first flight takes the row its layover
 * city would have had. The layover city again on each whole day of the stay; the pairing number on the trip's first
 * day, its credit under it; "---" on a day off; "=>" in the last row of the day a trip is released on, when the pack
 * prints it (`arrivalRow`). Read so against the line grids of all seven October 2026 packs, every flight number they
 * print lands on the pack's own day and row, and 99.9% of day cells read word for word. This reads the same things from the parsed trips, so
 * it works on every stored pack, not only ones parsed after the grid's raw text was kept.
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
  /**
   * A flight flown, a deadhead ("D/H"), hotel standby ("HSBY", after its hotel's city), the city the pilot lays over
   * in, or the pack's "=>" on the day a trip is released.
   */
  kind: "flight" | "deadhead" | "standby" | "layover" | "arrival";
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

/** Released this early on a later day than the trip's last flight, the pack leaves out its "=>": 0130. */
const RELEASE_DAY_FROM = 90;

/**
 * Minutes before a leg's departure its duty reports, for the row a duty starts in: an hour before a flight; two before
 * a deadhead into or out of another country (B777 ANC's SQ0478 out of SIN at 0115, printed the night before); a ride
 * by road (CAB) when it leaves, as TLC's 0635 van is printed after the layover city; a day on call when it starts.
 */
function reportLead(leg: TripLeg, startsDuty: boolean): number {
  if (leg.isStandby) return 0;
  if (!startsDuty) return 60;
  if (leg.equipment === "CAB") return 0;
  return leg.isDeadhead && (isInternationalCity(leg.depAirport) || isInternationalCity(leg.arrAirport)) ? 120 : 60;
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

/**
 * Each line's strip as last built, by line: it takes the whole month calendar to learn which trip owns each day, and a
 * card is drawn again every time it comes back into the list (a filter changed, the list re-sorted). Callers only read it.
 */
const built = new WeakMap<Line, { key: string; days: PackDay[] }>();

/** A line's strip, a day a column, `count` columns long. Without the bid period's real dates, only the trips' days and labels. */
export function buildPackRow(line: Line, bidPeriodStart: string | null, bidPeriodDays: number, count: number): PackDay[] {
  const key = `${bidPeriodStart}|${bidPeriodDays}|${count}`;
  const hit = built.get(line);
  if (hit && hit.key === key) return hit.days;
  const days = buildPackRowFresh(line, bidPeriodStart, bidPeriodDays, count);
  built.set(line, { key, days });
  return days;
}

function buildPackRowFresh(whole: Line, bidPeriodStart: string | null, bidPeriodDays: number, count: number): PackDay[] {
  // A run of day trips a day at a time, as the pack prints it: "31" over its own credit on each day.
  const line = lineByDay(whole);
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

  // Which of the strip's rows a time falls in, `minutesBefore` an instant at an airport: four a day, a quarter of its local day each.
  const first = DateTime.fromISO(bidPeriodStart, { zone: "UTC" });
  const rowOf = (iso: string, airport: string, minutesBefore: number): number | null => {
    const at = DateTime.fromISO(iso, { zone: timezoneForAirport(airport) ?? "UTC" }).minus({ minutes: minutesBefore });
    if (!at.isValid) return null;
    const day = Math.round(DateTime.fromISO(at.toISODate()!, { zone: "UTC" }).diff(first, "days").days);
    return day * PACK_TOKENS_PER_DAY + Math.floor((at.hour * PACK_TOKENS_PER_DAY) / 24);
  };
  const rowAt = (at: DateTime): number => {
    const day = Math.round(DateTime.fromISO(at.toISODate()!, { zone: "UTC" }).diff(first, "days").days);
    return day * PACK_TOKENS_PER_DAY + Math.floor((at.hour * PACK_TOKENS_PER_DAY) / 24);
  };
  // The pack's "=>", in the last row of the day a trip is released on (its report plus its TAFB, at the airport it
  // ends at). A release before 0130 counts as the day before. The pack prints it when that day is past the day of the
  // trip's last printed word — a night deadhead home, a landing after 0130 — or when the date line puts the release
  // two rows or more before the last leg's own report: ICN 0840 to ANC 2341 the day before.
  const arrivalRow = (trip: Line["trips"][number], lastRow: number, lastOwn: number): number | null => {
    const lead = trip.schedule[0]?.legs[0];
    const end = trip.schedule.at(-1)?.legs.at(-1);
    if (!lead || !end || lastRow === -Infinity) return null;
    const released = DateTime.fromISO(lead.depTimeZulu)
      .minus({ minutes: lead.startMinutes })
      .plus({ minutes: Math.round(tripReleaseHours(trip) * 60) })
      .setZone(timezoneForAirport(end.arrAirport) ?? "UTC");
    if (!released.isValid) return null;
    const counted = rowAt(released.minus({ minutes: RELEASE_DAY_FROM }));
    const shows = Math.floor(counted / PACK_TOKENS_PER_DAY) > Math.floor(lastRow / PACK_TOKENS_PER_DAY) || counted <= lastOwn - 2;
    return shows ? Math.floor(rowAt(released) / PACK_TOKENS_PER_DAY) * PACK_TOKENS_PER_DAY + PACK_TOKENS_PER_DAY - 1 : null;
  };
  const rows: (PackToken | null)[] = Array.from({ length: count * PACK_TOKENS_PER_DAY }, () => null);
  // A trip starting on the day the trip before is released on takes the day: no "=>" on it. Starting in the "=>"'s own
  // row, the pack prints neither there (B777 ANC line 1019's 6031). Any later leg prints over it.
  const spent = new Set<number>();
  const put = (r: number, t: PackToken, opensTrip = false) => {
    if (r < 0 || r >= rows.length || spent.has(r)) return;
    if (opensTrip) {
      const end = Math.floor(r / PACK_TOKENS_PER_DAY) * PACK_TOKENS_PER_DAY + PACK_TOKENS_PER_DAY - 1;
      if (rows[end]?.kind === "arrival") {
        rows[end] = null;
        if (end === r) return void spent.add(r);
      }
    }
    if (rows[r]?.kind === "arrival" && t.kind !== "layover" && t.kind !== "arrival") rows[r] = t;
    else if (!rows[r]) rows[r] = t;
  };
  // Each layover city goes in after every leg is in: a leg takes the row first.
  const cities: { row: number; token: PackToken }[] = [];
  for (const trip of line.trips) {
    let last = -Infinity;
    let lastOwn = -Infinity;
    trip.schedule.forEach((duty, k) => {
      duty.legs.forEach((leg, j) => {
        const opens = k === 0 && j === 0;
        const own = rowOf(leg.depTimeZulu, leg.depAirport, reportLead(leg, j === 0));
        if (own === null) return;
        lastOwn = own;
        last = j === 0 ? Math.max(own, last + 1) : last + 1;
        // An hour or two on call at the airport (STARPT) is "ASBY" on the line page; a hotel's is "HSBY".
        if (leg.isStandby) put(last, { text: standbyPlace(leg.flightNumber) === "airport" ? "ASBY" : "HSBY", kind: "standby" }, opens);
        else if (leg.isDeadhead || leg.equipment === "CAB") put(last, { text: "D/H", kind: "deadhead" }, opens);
        else put(last, { text: leg.flightNumber, kind: "flight" }, opens);
      });
      if (duty.layover) cities.push({ row: last + 1, token: { text: duty.layover.city, kind: "layover" } });
    });
    const arrow = arrivalRow(trip, last, lastOwn);
    if (arrow !== null) put(arrow, { text: "=>", kind: "arrival" });
  }
  for (const c of cities) put(c.row, c.token);
  out.forEach((day, i) => (day.tokens = rows.slice(i * PACK_TOKENS_PER_DAY, (i + 1) * PACK_TOKENS_PER_DAY).filter((t) => t !== null)));
  // A whole day at a layover hotel, nothing printed on it: the city again, as the pack prints it each day of the stay.
  month.days.forEach((day, i) => {
    if (i >= count || out[i].tokens.length > 0 || day.tripIndex === null || day.isOff) return;
    // The stay the day starts in, the first time through — after an eastbound date-line crossing the date also holds a
    // second. A day holding only the second time through (B777 ANC FO line 2031's whole day in OAK) has that one.
    const stays = [...day.segments].sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay).filter((s) => s.kind === "layover" && s.stay);
    const stay = stays.find((s) => !s.secondPass) ?? stays[0];
    if (stay?.stay) out[i].tokens = [{ text: stay.stay.city, kind: "layover" }];
  });
  return out;
}
