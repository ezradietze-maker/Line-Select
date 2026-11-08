import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { effectiveRange, pairingToTrip, settleOnItsDate } from "@/lib/pdf-parser/build-bidpack";
import type { ParsedPairing } from "@/lib/pdf-parser/types";
import type { BidPack, Seat, Trip } from "@/types/bidpack";

/**
 * The trips the pack prints that no regular line uses: its open time, the "remaining open trips" a pilot can bid in the
 * View/Add window (CBA 2026 25.E.4, every bid period). A pairing flies on set dates, so what's open is a date of a pairing,
 * not the pairing: each header prints its weekdays and date range ("37 TU ... EFFECTIVE SEPTEMBER 29 - OCTOBER 6"), and
 * any of those dates no line of this seat holds is open.
 *
 * Trips other pilots drop in conflicts join open time later, and aren't knowable from the pack.
 */

const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

type PackDates = Pick<BidPack, "bidPeriodStart" | "bidPeriodDays" | "base">;

/**
 * Which seat flies a pairing. Not printed as a rule; read from the October 2026 packs' own lines: "STANDARD CREW" is on both
 * seats' lines, "1 RFO" and "1 F/O" only on First Officers', "1 RF2" and "1 CAP" only on Captains'.
 */
export function pairingForSeat(crew: string | undefined, seat: Seat): boolean {
  const c = (crew ?? "").toUpperCase();
  if (/\b(RFO|F\/O)\b/.test(c)) return seat === "FO";
  if (/\b(RF2|CAP)\b/.test(c)) return seat === "CAP";
  return true;
}

/** The GMT dates a pairing departs on: its header's weekdays inside its printed date range. */
export function pairingDates(p: Pick<ParsedPairing, "effectiveText" | "operatesOn">, bidPeriodStart: string): string[] {
  const range = effectiveRange(p.effectiveText);
  if (!range || !p.operatesOn?.length) return [];
  const start = DateTime.fromISO(bidPeriodStart, { zone: "utc" });
  // A range prints no year: the one putting it nearest the bid month, for a month crossing New Year.
  const nearest = (mmdd: number) =>
    [start.year - 1, start.year, start.year + 1]
      .map((year) => DateTime.utc(year, Math.floor(mmdd / 100), mmdd % 100))
      .sort((a, b) => Math.abs(a.diff(start).toMillis()) - Math.abs(b.diff(start).toMillis()))[0];
  const dates: string[] = [];
  const last = nearest(range.to);
  for (let d = nearest(range.from); d <= last; d = d.plus({ days: 1 })) {
    if (p.operatesOn.includes(WEEKDAYS[d.weekday - 1])) dates.push(d.toISODate()!);
  }
  return dates;
}

/** The bid month's day that date of a pairing sits on, as the line grid would place it: the base's date of its report. Null without a verified schedule. */
export function pairingDayIndex(p: ParsedPairing, gmtDate: string, pack: PackDates): number | null {
  const leg = p.schedule[0]?.legs[0];
  const zone = timezoneForAirport(pack.base);
  if (!leg || !zone || !pack.bidPeriodStart || !/^\d{4}$/.test(leg.depTimeGmt ?? "")) return null;
  const departs = DateTime.fromISO(`${gmtDate}T${leg.depTimeGmt.slice(0, 2)}:${leg.depTimeGmt.slice(2)}:00Z`);
  const report = departs.minus({ minutes: leg.startMinutes }).setZone(zone);
  return Math.round(report.startOf("day").diff(DateTime.fromISO(pack.bidPeriodStart, { zone }).startOf("day"), "days").days);
}

/** Open trips of a seat: every date of every pairing for it, less the ones its lines hold (`held`: pairing number to the day indices lines place it on, repeats counted). */
export function openTripsOfSeat(pairings: ParsedPairing[], held: Map<string, number[]>, seat: Seat, bidPackMonth: string, pack: PackDates): Trip[] {
  if (!pack.bidPeriodStart) return [];
  const left = new Map([...held].map(([n, days]) => [n, [...days]]));
  const out: Trip[] = [];
  for (const p of pairings) {
    if (!pairingForSeat(p.crew, seat)) continue;
    for (const date of pairingDates(p, pack.bidPeriodStart)) {
      const day = pairingDayIndex(p, date, pack);
      if (day === null || day < 0 || day >= pack.bidPeriodDays) continue;
      const taken = left.get(p.sequenceNumber);
      const at = taken?.indexOf(day) ?? -1;
      if (at >= 0) {
        taken!.splice(at, 1);
        continue;
      }
      out.push(settleOnItsDate({ ...pairingToTrip(p, bidPackMonth), startDayIndex: day }, pack));
    }
  }
  return out;
}
