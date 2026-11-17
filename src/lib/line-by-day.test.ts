import { describe, expect, it } from "vitest";
import { buildPackRow } from "@/lib/bidpack-row";
import { buildLineCalendar } from "@/lib/ics-export";
import { buildLineTimeline } from "@/lib/line-timeline";
import { groupDepartures } from "@/lib/metrics/departures";
import { buildDetailedMonth } from "@/lib/month-detail";
import { anchorTripToItsDate, dayTripsOf, lineByDay, tripDaysShown } from "@/lib/trip-anchor";
import type { Line, Trip, TripDutyPeriod, TripLeg } from "@/types/bidpack";

/**
 * The A300 Memphis captain's line 1044, October 2026, as its line page prints it: trip 31 on the 2nd, then trip 31 again
 * on each of the 13th to the 16th — "31" over "624" under each day, home each night. The same day trip: report 02:06,
 * out to BWI, a hotel, back in MEM at 23:38. The parser keeps the four days as one trip (`runStarts`).
 */
const START = "2026-09-28";
const PACK = { bidPeriodStart: START, base: "MEM" };
/** "HHMM" this long after the 02:06 report: on Memphis's clock, or (`gmt`) five hours on. */
const clock = (minutesAfterReport: number, gmt = false) => {
  const m = (2 * 60 + 6 + (gmt ? 300 : 0) + minutesAfterReport) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}`;
};
const leg = (flightNumber: string, from: string, to: string, start: number, end: number): TripLeg => ({
  flightNumber,
  equipment: "55",
  isDeadhead: false,
  depAirport: from,
  arrAirport: to,
  depTimeLocal: clock(start),
  arrTimeLocal: clock(end),
  depTimeGmt: clock(start, true),
  arrTimeGmt: clock(end, true),
  blockHours: (end - start) / 60,
  startMinutes: start,
  endMinutes: end,
  depTimeZulu: "",
  arrTimeZulu: "",
});
/** One day of trip 31, `shift` minutes after the trip's first report. */
const day31 = (shift: number): TripDutyPeriod[] => [
  {
    reportTimeLocal: "0206",
    startMinutes: shift,
    legs: [leg("1482", "MEM", "BWI", shift + 60, shift + 184)],
    layover: { city: "BWI", hotelName: null, transportToHotel: null, transportFromHotel: null, hours: 14.43, startMinutes: shift + 199, endMinutes: shift + 1065 },
  },
  { reportTimeLocal: "2006", startMinutes: shift + 1080, legs: [leg("1217", "BWI", "MEM", shift + 1200, shift + 1292)], layover: null },
];
const trip31 = (startDayIndex: number, days: number): Trip =>
  anchorTripToItsDate(PACK, {
    id: "p-31",
    pairingNumber: "31",
    days,
    layoverCities: Array(days).fill("BWI"),
    layoverDetails: Array(days).fill({ city: "BWI", hotelName: null }),
    reportTime: "early",
    international: false,
    deadheadLegs: 0,
    creditHours: 6.4 * days,
    landings: 2 * days,
    tafbHours: 22.03 * days,
    departures: 2 * days,
    dutyPeriods: 2 * days,
    schedule: Array.from({ length: days }, (_, k) => day31(k * 1440)).flat(),
    zuluAnchor: "",
    startDayIndex,
    ...(days > 1 ? { runStarts: Array.from({ length: days }, (_, k) => 2 * k) } : {}),
  });
const line1044 = (): Line => ({
  id: "line-1044",
  lineNumber: "1044",
  trips: [trip31(4, 1), trip31(15, 4)],
  daysOff: 23,
  totalCreditHours: 32,
  totalTafbHours: 110.15,
  totalLandings: 10,
  totalDepartures: 10,
  gridOffDays: [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 19, 20, 21, 22, 23, 24, 25, 26, 27],
});
const RUN_DAYS = [15, 16, 17, 18];

describe("lineByDay", () => {
  it("draws a run of the same day trip a day at a time, each its own trip with its own credit", () => {
    const line = line1044();
    const shown = lineByDay(line);
    expect(shown.trips.map((t) => [t.pairingNumber, t.startDayIndex, t.days, t.creditHours])).toEqual([
      ["31", 4, 1, 6.4],
      ...RUN_DAYS.map((d) => ["31", d, 1, 6.4]),
    ]);
    // The days are the run's own (`dayTripsOf`), and the same objects each time; the line itself is left as it is.
    expect(shown.trips.slice(1)).toEqual(dayTripsOf(line.trips[1]));
    expect(lineByDay(line)).toBe(shown);
    expect(line.trips).toHaveLength(2);
  });

  it("is the line itself when it has no run", () => {
    const line = { ...line1044(), trips: [trip31(4, 1)] };
    expect(lineByDay(line)).toBe(line);
  });
});

describe("a run of day trips on the line's strips and calendar", () => {
  it("prints the trip's number and its own credit, and starts and ends it, on each day of the pack strip", () => {
    const row = buildPackRow(line1044(), START, 28, 35);
    for (const d of RUN_DAYS) {
      expect(row[d].label).toEqual({ number: "31", creditHours: 6.4 });
      expect(row[d].trip).toMatchObject({ start: true, end: true });
      expect(row[d].tokens.map((t) => t.text)).toEqual(["1482", "BWI", "1217"]);
    }
    expect(row[19].label?.number).toBeUndefined();
  });

  it("gives each day its own card on the Timeline, report to its own landing", () => {
    const timeline = buildLineTimeline(line1044(), { ...PACK, bidPeriodDays: 28 }, 35);
    const run = timeline.trips.filter((t) => t.start >= 15 * 1440);
    expect(run.map((t) => [t.number, t.creditHours, t.days])).toEqual(RUN_DAYS.map(() => ["31", 6.4, 1]));
    run.forEach((t, k) => {
      // Reports 02:06 and lands 23:38 on its own day.
      expect(t.start).toBe(RUN_DAYS[k] * 1440 + 126);
      expect(t.end).toBe(RUN_DAYS[k] * 1440 + 23 * 60 + 38);
    });
  });

  it("shows each day of the month calendar as its own trip: number, credit, report and end", () => {
    const month = buildDetailedMonth(line1044(), START, 28);
    for (const d of RUN_DAYS) {
      const day = month.days[d];
      expect(day).toMatchObject({ tripNumber: "31", tripCreditHours: 6.4, tripDay: 1, tripDayCount: 1, isTripStart: true, isTripEnd: true, dutyStart: "02:06" });
      expect(day.finish).toEqual({ city: "MEM", time: "23:38", nextDay: false });
      expect(day.title).toContain("trip 31, day 1 of 1");
    }
  });

  it("starts each day on its own Zulu date too, though the day before lands after midnight Z", () => {
    const month = buildDetailedMonth(line1044(), START, 28, {}, undefined, "zulu");
    for (const d of RUN_DAYS) {
      expect(month.days[d]).toMatchObject({ tripNumber: "31", isTripStart: true, dutyStart: "07:06" });
      // The landing at 04:38Z is the day before's, shown on this day as it.
      if (d > RUN_DAYS[0]) expect(month.days[d].spill?.landsAt).toBe("04:38");
    }
    expect(month.days[RUN_DAYS[0]].finish).toEqual({ city: "MEM", time: "04:38", nextDay: true });
  });

  it("joins the run's days into the departures the scores count, each day turning out of the one before", () => {
    const line = line1044();
    const options = { base: "MEM" };
    const month = buildDetailedMonth(line, START, 28, {}, options);
    // The count is the line's own, as the scores take it.
    expect(month.summary.departures).toBe(groupDepartures(line.trips, PACK).length);
    expect(month.days[15].chain).toBeNull();
    for (const d of RUN_DAYS.slice(1)) {
      expect(month.days[d].chain).toMatchObject({ fromTripNumber: "31", city: "MEM", landed: "23:38", reports: "02:06", turnMinutes: 148 });
    }
  });

  it("joins them for a commuter too, who never has the hours to go home between them", () => {
    const line = line1044();
    const options = { base: "MEM", homeAirports: ["DEN"] };
    const month = buildDetailedMonth(line, START, 28, {}, options);
    expect(month.summary.departures).toBe(groupDepartures(line.trips, PACK, options).length);
    for (const d of RUN_DAYS.slice(1)) expect(month.days[d].chain).toMatchObject({ fromTripNumber: "31", turnMinutes: 148, homeHours: 24 });
    // Each day still ends on its own day, where the pack puts it.
    for (const d of RUN_DAYS) expect(month.days[d].finish?.time).toBe("23:38");
  });
});

/**
 * The MD11 Memphis first officer's line 2020, October 2026: trip 30 on the 6th and the 7th, and again on the 20th and
 * the 21st, trip 33 on the 22nd. Trip 30 reports 15:05, overnights in Newark and is home at 11:03 the next day: a 2-day
 * trip, as the line prints it on the 6th and 7th. On the 20th and 21st the parser kept the two as one run (`runStarts`),
 * as each one's grid day is followed by a trip the next day.
 */
const at = (minutesAfterReport: number, hoursFromMemphis = 0) => {
  const m = (15 * 60 + 5 + hoursFromMemphis * 60 + minutesAfterReport + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}`;
};
const leg30 = (from: string, to: string, start: number, end: number): TripLeg => ({
  flightNumber: from === "MEM" ? "100" : "101",
  equipment: "M1",
  isDeadhead: false,
  depAirport: from,
  arrAirport: to,
  depTimeLocal: at(start, from === "EWR" ? 1 : 0),
  arrTimeLocal: at(end, to === "EWR" ? 1 : 0),
  depTimeGmt: at(start, 5),
  arrTimeGmt: at(end, 5),
  blockHours: (end - start) / 60,
  startMinutes: start,
  endMinutes: end,
  depTimeZulu: "",
  arrTimeZulu: "",
});
const day30 = (shift: number): TripDutyPeriod[] => [
  {
    reportTimeLocal: "1505",
    startMinutes: shift,
    legs: [leg30("MEM", "EWR", shift + 60, shift + 216)],
    layover: { city: "EWR", hotelName: null, transportToHotel: null, transportFromHotel: null, hours: 12.23, startMinutes: shift + 216, endMinutes: shift + 950 },
  },
  { reportTimeLocal: "0655", startMinutes: shift + 950, legs: [leg30("EWR", "MEM", shift + 1025, shift + 1198)], layover: null },
];
const trip30 = (number: string, startDayIndex: number, days: number, runDays = 1): Trip =>
  anchorTripToItsDate(PACK, {
    id: `p-${number}`,
    pairingNumber: number,
    days,
    layoverCities: Array(runDays).fill("EWR"),
    layoverDetails: Array(runDays).fill({ city: "EWR", hotelName: null }),
    reportTime: "afternoon",
    international: false,
    deadheadLegs: 0,
    creditHours: 6.4 * runDays,
    landings: 2 * runDays,
    tafbHours: 20.47 * runDays,
    departures: 2 * runDays,
    dutyPeriods: 2 * runDays,
    schedule: Array.from({ length: runDays }, (_, k) => day30(k * 1440)).flat(),
    zuluAnchor: "",
    startDayIndex,
    ...(runDays > 1 ? { runStarts: Array.from({ length: runDays }, (_, k) => 2 * k) } : {}),
  });
const line2020 = (): Line => ({
  id: "line-2020",
  lineNumber: "2020",
  // Oct 6 and 7 as two trips; Oct 20 and 21 as one run of two days, three days long; trip 33 on Oct 22.
  trips: [trip30("30", 8, 2), trip30("30", 9, 2), trip30("30", 22, 3, 2), trip30("33", 24, 2)],
  daysOff: 21,
  totalCreditHours: 32,
  totalTafbHours: 102.35,
  totalLandings: 10,
  totalDepartures: 10,
  gridOffDays: [0, 1, 2, 3, 4, 5, 6, 7, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 26, 27],
});

describe("a run of the same overnight trip, a day at a time", () => {
  it("is still one day each for the scores, but two days wherever it's named or drawn, as when flown alone", () => {
    const line = line2020();
    const run = line.trips[2];
    expect(dayTripsOf(run).map((t) => t.days)).toEqual([1, 1]);
    expect(dayTripsOf(run).map(tripDaysShown)).toEqual([2, 2]);
    expect(line.trips.slice(0, 2).map(tripDaysShown)).toEqual([2, 2]);
    // A day trip is one day, home the same day or (leaving at 23:50) just after midnight, as its pairing prints it.
    expect(lineByDay(line1044()).trips.map(tripDaysShown)).toEqual([1, 1, 1, 1, 1]);
    const late = trip31(15, 2);
    late.schedule = late.schedule.map((d) => (d.layover ? d : { ...d, legs: d.legs.map((l) => ({ ...l, startMinutes: l.startMinutes + 104, endMinutes: l.endMinutes + 104 })) }));
    expect(dayTripsOf(late).map(tripDaysShown)).toEqual([1, 1]);
  });

  it("puts each day in the calendar download over both its days, as the same trip flown alone", () => {
    const content = buildLineCalendar(line2020(), START, "OCT26").content!;
    expect(content.match(/^DTSTART;VALUE=DATE:.*$/gm)).toEqual(["20261006", "20261007", "20261020", "20261021", "20261022"].map((d) => `DTSTART;VALUE=DATE:${d}`));
    expect(content.match(/^DTEND;VALUE=DATE:.*$/gm)).toEqual(["20261008", "20261009", "20261022", "20261023", "20261024"].map((d) => `DTEND;VALUE=DATE:${d}`));
    expect(content).not.toContain("1-day trip");
    expect(content.match(/2-day trip/g)).toHaveLength(5);
  });

  it("counts each day's two days on the month calendar and the Timeline, and still ends it at 11:03 the next day", () => {
    const month = buildDetailedMonth(line2020(), START, 28);
    for (const d of [8, 9, 22, 23]) {
      expect(month.days[d]).toMatchObject({ tripNumber: "30", tripDay: 1, tripDayCount: 2, isTripStart: true, dutyStart: "15:05" });
      expect(month.days[d].title).toContain("trip 30, day 1 of 2");
    }
    // Home the next morning, shown on that day under the trip after it: the run's days as the trips flown alone.
    for (const d of [23, 24]) expect(month.days[d].spill?.landsAt).toBe("11:03");
    expect(month.days[9].spill?.landsAt).toBe("11:03");
    const timeline = buildLineTimeline(line2020(), { ...PACK, bidPeriodDays: 28 }, 35);
    expect(timeline.trips.map((t) => [t.number, t.days])).toEqual([["30", 2], ["30", 2], ["30", 2], ["30", 2], ["33", 2]]);
  });
});
