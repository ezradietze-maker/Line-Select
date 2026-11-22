import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { buildPackRow, packColumnCount } from "@/lib/bidpack-row";
import { isSamplePack, SAMPLE_MONTH } from "@/lib/fake-trade-offers";
import { workingDayIndices } from "@/lib/line-month";
import { buildHomeDays } from "@/lib/trip-timeline";
import { pairingDate, pastedMatches } from "@/lib/view-add";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";

const pack = SAMPLE_BID_PACK;

describe("the sample bid pack", () => {
  it("is the sample by its id and its month, as the rankings' history tells it apart", () => {
    expect(isSamplePack(pack)).toBe(true);
    expect(pack.month).toBe(SAMPLE_MONTH);
  });

  it("is on dates, like an uploaded pack: a 28-day period and every trip on its own day", () => {
    expect(pack.bidPeriodStart).toBe("2027-08-30");
    expect(pack.bidPeriodDays).toBe(28);
    for (const line of pack.lines) for (const trip of line.trips) expect(trip.startDayIndex).not.toBeNull();
  });

  it("prints each leg's local and GMT times as the same instant its Zulu time is", () => {
    for (const trip of pack.lines.flatMap((l) => l.trips)) {
      for (const leg of trip.schedule.flatMap((d) => d.legs)) {
        const at = (iso: string, zone: string) => DateTime.fromISO(iso, { zone }).toFormat("HHmm");
        expect(at(leg.depTimeZulu, "UTC")).toBe(leg.depTimeGmt);
        expect(at(leg.arrTimeZulu, "UTC")).toBe(leg.arrTimeGmt);
        expect(at(leg.depTimeZulu, timezoneForAirport(leg.depAirport)!)).toBe(leg.depTimeLocal);
        expect(at(leg.arrTimeZulu, timezoneForAirport(leg.arrAirport)!)).toBe(leg.arrTimeLocal);
      }
    }
  });

  it("fills each line's strip with its flights and layover cities on the days they happen", () => {
    const line = pack.lines.find((l) => l.lineNumber === "9004")!;
    const days = buildPackRow(line, pack.bidPeriodStart, pack.bidPeriodDays, packColumnCount(pack));
    const words = (i: number) => days[i].tokens.map((t) => t.text);
    // Trip 501 reports Mon Sep 6 (day 7) to LAX and flies home the next day; trip 502 leaves for Paris on Wed Sep 15.
    // As on a real line grid, the layover city follows the flight in and isn't printed again before the flight out.
    expect(words(7)).toEqual(["101", "LAX"]);
    expect(words(8)).toEqual(["102"]);
    expect(words(16)).toEqual(["205", "CDG"]);
    expect(words(17)).toEqual(["206"]);
    expect(days[7].label).toEqual({ number: "501", creditHours: 7.8 });
  });

  it("prints each line's block hours, as a line in a real pack does, rather than leaving its strip's Block blank", () => {
    for (const line of pack.lines) {
      const legs = line.trips.flatMap((t) => t.schedule.flatMap((d) => d.legs)).filter((l) => !l.isDeadhead);
      expect(line.totalBlockHours).toBe(legs.reduce((s, l) => s + (l.blockHours ?? 0), 0));
    }
    // Line 9004: trip 501 (3:30 + 3:30) and trip 502 (9:00 + 9:00).
    expect(pack.lines.find((l) => l.lineNumber === "9004")!.totalBlockHours).toBe(25);
  });

  it("prints each line's days off as the days its own trips leave free, and marks those days the way a line's grid does", () => {
    for (const line of pack.lines) {
      const worked = new Set<number>();
      for (const trip of line.trips) {
        const home = buildHomeDays(trip, "local");
        expect(trip.days).toBe(home.length);
        for (const day of home) worked.add(Math.round(DateTime.fromISO(day.date!).diff(DateTime.fromISO(pack.bidPeriodStart!), "days").days));
      }
      const free = Array.from({ length: pack.bidPeriodDays }, (_, i) => i).filter((i) => !worked.has(i));
      expect([line.lineNumber, line.daysOff]).toEqual([line.lineNumber, free.length]);
      expect(line.gridOffDays).toEqual(free);
      expect(workingDayIndices(line, pack.bidPeriodStart, pack.bidPeriodDays)!.size).toBe(pack.bidPeriodDays - line.daysOff);
    }
    // Line 9001 flies one 2-day trip in the 28-day period.
    expect(pack.lines.find((l) => l.lineNumber === "9001")!.daysOff).toBe(26);
    const average = pack.lines.reduce((s, l) => s + l.daysOff, 0) / pack.lines.length;
    expect(pack.info!.averageDaysOff).toBe(Math.round(average * 10) / 10);
  });

  it("times every trip as a real pack does: report an hour before the first flight of each duty, release 30 minutes after the last", () => {
    const hhmm = (ms: number, airport: string) => DateTime.fromMillis(ms, { zone: airport === "UTC" ? "UTC" : timezoneForAirport(airport)! }).toFormat("HHmm");
    for (const trip of pack.lines.flatMap((l) => l.trips)) {
      const anchor = Date.parse(trip.zuluAnchor);
      trip.schedule.forEach((duty, i) => {
        const first = duty.legs[0];
        const last = duty.legs.at(-1)!;
        const report = first.startMinutes - 60;
        expect(hhmm(anchor + report * 60_000, first.depAirport)).toBe(duty.reportTimeLocal);
        // The trip starts at its report at base; a duty after a layover starts at the hotel pickup its layover prints, before the report.
        const pickup = trip.schedule[i - 1]?.layover;
        if (!pickup) expect(duty.startMinutes).toBe(report);
        else {
          expect(duty.startMinutes).toBeLessThan(report);
          expect(hhmm(anchor + duty.startMinutes * 60_000, first.depAirport)).toBe(pickup.pickupTimeLocal);
          expect(hhmm(anchor + duty.startMinutes * 60_000, "UTC")).toBe(pickup.pickupTimeGmt);
        }
        // A duty's time on duty runs from its report to its release.
        expect(duty.totals!.dutyHours * 60).toBe(last.endMinutes + 30 - report);
        expect(duty.totals!.blockHours).toBe(duty.legs.reduce((s, l) => s + (l.isDeadhead ? 0 : (l.blockHours ?? 0)), 0));
        const next = trip.schedule[i + 1];
        if (!next) return expect(duty.layover).toBeNull();
        // The layover prints release to the next report, and lasts on the clock from landing to the pickup.
        expect(duty.layover!.hours * 60).toBe(next.legs[0].startMinutes - 60 - (last.endMinutes + 30));
        expect([duty.layover!.startMinutes, duty.layover!.endMinutes]).toEqual([last.endMinutes, next.startMinutes]);
      });
      const finalArrival = trip.schedule.at(-1)!.legs.at(-1)!.endMinutes;
      expect(trip.tafbHours * 60).toBe(finalArrival + 30);
      // Credit is its duties' credit, or the trip rig (1 CH per 3:45 away) when that pays more, as a pack prints it.
      expect(trip.creditHours).toBeCloseTo(Math.max(trip.schedule.reduce((s, d) => s + d.totals!.creditHours, 0), trip.tafbHours / 3.75), 6);
      expect(trip.landings).toBe(trip.schedule.flatMap((d) => d.legs).filter((l) => !l.isDeadhead).length);
      expect(trip.dutyPeriods).toBe(trip.schedule.length);
      expect(trip.layoverCities).toEqual(trip.schedule.flatMap((d) => (d.layover ? [d.layover.city] : [])));
    }
  });

  it("prints each line's totals as the sum of its trips, with nothing carried into the next period", () => {
    for (const line of pack.lines) {
      const sum = (f: (t: (typeof line.trips)[number]) => number) => line.trips.reduce((s, t) => s + f(t), 0);
      expect(line.totalCreditHours).toBe(sum((t) => t.creditHours));
      expect(line.totalTafbHours).toBe(sum((t) => t.tafbHours));
      expect(line.totalLandings).toBe(sum((t) => t.landings));
      expect(line.totalDutyPeriods).toBe(sum((t) => t.dutyPeriods!));
      expect([line.carryOverCreditHours, line.carryOverBlockHours]).toEqual([0, 0]);
      for (const trip of line.trips) expect(trip.startDayIndex! + trip.days).toBeLessThanOrEqual(pack.bidPeriodDays);
    }
    const credits = pack.lines.map((l) => l.totalCreditHours);
    expect([pack.info!.lowLineCreditHours, pack.info!.highLineCreditHours]).toEqual([Math.min(...credits), Math.max(...credits)]);
  });

  it("gives every reserve line the days it stands, as many as the reserve guarantee pays for", () => {
    const rDays = pack.info!.rlgHours! / pack.info!.rDayValueHours!;
    for (const reserve of pack.reserveLines!) {
      expect(reserve.days!.filter((d) => d < pack.bidPeriodDays)).toHaveLength(Math.round(rDays));
      expect(new Set(reserve.days).size).toBe(reserve.days!.length);
    }
  });

  it("can be matched against an open-time list by trip number and date", () => {
    const universe = pack.lines.flatMap((l) => l.trips);
    const c = pack.lines.find((l) => l.lineNumber === "9005")!.trips[1];
    expect(pairingDate(c, pack)).toBe("2027-09-14");
    // Line 9006 flies it the day before, a day out: kept as the next-best match, as on a real pack.
    expect(pastedMatches({ tripNumber: "503", month: 9, day: 14 }, universe, pack).map((m) => [m.trip, m.gap])).toEqual([
      [c, 0],
      [pack.lines.find((l) => l.lineNumber === "9006")!.trips[1], 1],
    ]);
  });
});
