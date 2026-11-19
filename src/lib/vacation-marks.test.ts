import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { lineVacationMark, reachSpans } from "@/lib/vacation-marks";
import { flyVacationsOnLine, vacationId, type ChosenVacation } from "@/lib/vacation-lines";
import type { BidPack, Line, Trip, VacationPeriod } from "@/types/bidpack";

const ZONE = "America/Chicago";
const START = "2026-09-28";
const trip = (num: string, day: number): Trip =>
  ({
    id: `t-${num}`, pairingNumber: num, days: 2, layoverCities: ["IND"], layoverDetails: [], reportTime: "early", international: false, deadheadLegs: 0, creditHours: 15, landings: 1, tafbHours: 38, departures: 1, dutyPeriods: 1, zuluAnchor: "", startDayIndex: day,
    schedule: [{ reportTimeLocal: "0800", startMinutes: 0, layover: null, legs: [{ flightNumber: "1", equipment: "76", isDeadhead: false, depAirport: "MEM", depTimeLocal: "0900", depTimeGmt: "1400", arrAirport: "IND", arrTimeLocal: "1100", arrTimeGmt: "1600", blockHours: 2, startMinutes: 60, endMinutes: 38 * 60, depTimeZulu: "", arrTimeZulu: "" }] }],
  }) as Trip;
const line = (trips: Trip[]): Line => {
  const on = new Set(trips.flatMap((t) => [t.startDayIndex!, t.startDayIndex! + 1]));
  const off = Array.from({ length: 28 }, (_, i) => i).filter((i) => !on.has(i));
  return { id: "l", lineNumber: "1001", trips, daysOff: off.length, totalCreditHours: 30, totalTafbHours: 76, totalLandings: 2, totalDepartures: 2, gridOffDays: off };
};
const pack = (l: Line): BidPack => ({ id: "p", month: "OCT26", base: "MEM", aircraft: "B767", seat: "CAP", bidPeriodDays: 28, bidPeriodStart: START, lines: [l] });
const vac = (day: number, days = 7): VacationPeriod => {
  const from = DateTime.fromISO(`${START}T01:30`, { zone: ZONE }).plus({ days: day });
  return { from: from.toUTC().toISO()!, to: from.plus({ days }).minus({ minutes: 1 }).toUTC().toISO()!, days };
};

const L = line([trip("101", 8), trip("202", 14)]);
const P = pack(L);
const V = vac(10);
const chosen: ChosenVacation[] = [{ vacation: V, choice: "use" }];

describe("the vacation as a line's pictures draw it", () => {
  it("falls on its days, base day to base day: Oct 8–14 are columns 10–16, from 0130", () => {
    const mark = lineVacationMark(P, flyVacationsOnLine(L, P, chosen), chosen)!;
    expect(mark.pieces).toHaveLength(1);
    expect(mark.pieces[0]).toMatchObject({ firstDay: 10, lastDay: 16, awardedFirstDay: 10, days: 7, earlier: 5, later: 5 });
    expect(mark.pieces[0].start).toBe(10 * 1440 + 90);
    // Trip 202 (day 14) is under it: its report is marked to fade.
    expect(mark.removedStarts).toEqual([14 * 1440 + 8 * 60]);
    expect(mark.removedDays).toEqual([14]);
  });

  it("slid, it's drawn where it's slid to, with where the pack had it, and its reach still counted from there", () => {
    const vl = flyVacationsOnLine(L, P, chosen, new Set(), { offsets: { [vacationId(V)]: 2 } });
    const p = lineVacationMark(P, vl, chosen)!.pieces[0];
    expect([p.firstDay, p.lastDay, p.awardedFirstDay, p.awardedLastDay]).toEqual([12, 18, 10, 16]);
    const { before, after } = reachSpans(p);
    // 5 earlier than awarded is 7 before where it is now; 5 later than awarded is 3 after.
    expect(before).toEqual([p.start - 7 * 1440, p.start]);
    expect(after).toEqual([p.end, p.end + 3 * 1440]);
  });

  it("takes each line's own reach when it's been worked out", () => {
    const p = lineVacationMark(P, flyVacationsOnLine(L, P, chosen), chosen, [{ id: vacationId(V), earlier: 2, later: 0 }])!.pieces[0];
    expect([p.earlier, p.later]).toEqual([2, 0]);
    expect(reachSpans(p).after).toBeNull();
  });

  it("draws nothing when the vacation isn't being taken", () => {
    const none: ChosenVacation[] = [{ vacation: V, choice: "not-taking" }];
    expect(lineVacationMark(P, flyVacationsOnLine(L, P, none), none)).toBeNull();
  });
});
