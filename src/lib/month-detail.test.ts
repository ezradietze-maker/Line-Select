import { describe, expect, it } from "vitest";
import { buildDetailedMonth, dayRoute, monthDepartureOptions, toStripSegment } from "@/lib/month-detail";
import { groupDepartures } from "@/lib/metrics/departures";
import type { TimelineSegment } from "@/lib/trip-timeline";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import { lineStandbyDays } from "@/lib/standby";
import type { Line } from "@/types/bidpack";

const START = "2026-09-28"; // a Monday
const line = (number: string) => SAMPLE_BID_PACK.lines.find((l) => l.lineNumber === number)!;

/** A real sample line with its trips pinned to real start days, as a parsed pack's grid would. */
function placed(number: string, starts: number[]): Line {
  const l = line(number);
  return { ...l, trips: l.trips.map((t, i) => ({ ...t, startDayIndex: starts[i] })) };
}

describe("buildDetailedMonth", () => {
  it("lays the period out with real dates, Monday-first weekday headers, and shaded weekends", () => {
    const m = buildDetailedMonth(placed("9006", [2, 10]), START, 28);
    expect(m.days).toHaveLength(28);
    expect(m.placementIsReal).toBe(true);
    expect(m.weekdayHeaders?.[0]).toBe("Mon");
    expect(m.days[0].label).toBe("28");
    expect(m.days[3].label).toBe("1");
    expect(m.days.filter((d) => d.isWeekend)).toHaveLength(8);
  });

  it("carries the trip's own bid-pack number on the day it starts, and only there", () => {
    const m = buildDetailedMonth(placed("9006", [2, 10]), START, 28);
    const starts = m.days.filter((d) => d.isTripStart);
    expect(starts.map((d) => d.tripNumber)).toEqual(["502", "503"]);
    expect(starts.map((d) => d.dayIndex)).toEqual([2, 10]);
    expect(m.days[3].isTripStart).toBe(false);
  });

  it("describes each run of days off and where each day sits in its run", () => {
    const m = buildDetailedMonth(placed("9006", [2, 10]), START, 28);
    expect(m.summary.offRuns.reduce((a, b) => a + b, 0)).toBe(m.summary.daysOff);
    expect(m.summary.longestOffRun).toBe(Math.max(...m.summary.offRuns));
    const first = m.days.find((d) => d.kind === "off")!;
    expect(first.offRun).toEqual({ length: m.summary.offRuns[0], isFirst: true, position: 1 });
    expect(m.days[1].offRun?.position).toBe(2);
  });

  it("counts weekends off as Saturday-and-Sunday pairs that are both free", () => {
    const m = buildDetailedMonth(placed("9001", [2]), START, 28);
    expect(m.summary.weekendsTotal).toBe(4);
    expect(m.summary.weekendsOff).toBeGreaterThanOrEqual(3);
    expect(m.summary.weekendsOff).toBeLessThanOrEqual(4);
  });

  it("marks a layover day with its city and how the pilot feels about it", () => {
    const m = buildDetailedMonth(placed("9002", [2]), START, 28, { CDG: "avoid", HNL: "love" });
    const layover = m.days.find((d) => d.layoverCode === "CDG");
    expect(layover).toBeDefined();
    expect(layover!.citySentiment).toBe("avoid");
    expect(layover!.layoverInternational).toBe(true);
    expect(m.summary.cities).toEqual([expect.objectContaining({ code: "CDG", sentiment: "avoid", international: true })]);
    expect(m.summary.internationalLayoverNights).toBe(m.summary.layoverNights);
  });

  it("reports when the duty starts, and when the last flight lands on the day the trip ends", () => {
    const m = buildDetailedMonth(placed("9001", [2]), START, 28);
    const startDay = m.days[2];
    const endDay = m.days.find((d) => d.isTripEnd)!;
    expect(startDay.dutyStart).toMatch(/^\d\d:\d\d$/);
    expect(endDay.releaseTime).toMatch(/^\d\d:\d\d$/);
    expect(m.summary.earliestDutyStart).not.toBeNull();
    expect(m.summary.latestRelease).not.toBeNull();
  });

  it("flags a red-eye and counts its landings", () => {
    // Trip B leaves CDG at 03:45 local — a red-eye by its printed local time.
    const m = buildDetailedMonth(placed("9002", [2]), START, 28);
    expect(m.days.some((d) => d.redEye)).toBe(true);
    expect(m.days.reduce((s, d) => s + d.landings, 0)).toBeGreaterThan(0);
  });

  it("gives every trip day a 24-hour strip inside the day", () => {
    const m = buildDetailedMonth(placed("9004", [1, 8]), START, 28);
    for (const d of m.days.filter((x) => x.kind !== "off" && x.kind !== "estimated")) {
      expect(d.strip.length).toBeGreaterThan(0);
      for (const s of d.strip) {
        expect(s.start).toBeGreaterThanOrEqual(0);
        expect(s.end).toBeLessThanOrEqual(1440);
        expect(s.end).toBeGreaterThanOrEqual(s.start);
      }
    }
  });

  it("shows hotel standby days in their own color, and reports the line's own standby count", () => {
    const base = placed("9002", [2]);
    const trip = base.trips[0];
    const duty = trip.schedule[trip.schedule.length - 1];
    const standbyDuty = { ...duty, legs: [{ ...duty.legs[0], flightNumber: "STHOTL", equipment: "", blockHours: null, isStandby: true }], layover: null };
    const withStandby: Line = { ...base, trips: [{ ...trip, days: trip.days + 1, standbyDays: 1, schedule: [...trip.schedule, standbyDuty] }] };
    const m = buildDetailedMonth(withStandby, START, 28);
    expect(m.days.some((d) => d.hasStandby)).toBe(true);
    expect(m.summary.standbyDays).toBe(lineStandbyDays(withStandby));
  });

  it("draws a segment whose end reads before its start as running to the end of the day", () => {
    // A long eastbound flight: departs 21:55 local, local arrival reads 13:00 — several zones later.
    const seg = (start: number, end: number) => ({ kind: "flying", startMinuteOfDay: start, endMinuteOfDay: end }) as TimelineSegment;
    expect(toStripSegment(seg(1315, 780))).toEqual({ kind: "flying", start: 1315, end: 1440 });
    expect(toStripSegment(seg(-20, 90))).toEqual({ kind: "flying", start: 0, end: 90 });
    expect(toStripSegment(seg(600, 1500))).toEqual({ kind: "flying", start: 600, end: 1440 });
    expect(toStripSegment(seg(600, 700))).toEqual({ kind: "flying", start: 600, end: 700 });
  });

  it("carries the bid pack's own printed days off next to the calendar's count", () => {
    const m = buildDetailedMonth(placed("9002", [2]), START, 28);
    expect(m.summary.printedDaysOff).toBe(line("9002").daysOff);
  });

  it("falls back to the sequential layout, and says so, when real dates can't be confirmed", () => {
    const m = buildDetailedMonth(line("9006"), null, 28);
    expect(m.placementIsReal).toBe(false);
    expect(m.weekdayHeaders).toBeNull();
    expect(m.days[0].weekday).toBeNull();
  });
});

describe("calendar drawn from the grid's own off days", () => {
  /** A one-trip line whose grid says exactly which days are off — deliberately not the days the trip's own length would leave. */
  function withGrid(off: number[]): Line {
    const l = placed("9001", [4]);
    return { ...l, daysOff: off.length, gridOffDays: off };
  }
  const offExcept = (work: number[]) => Array.from({ length: 28 }, (_, i) => i).filter((i) => !work.includes(i));

  it("marks exactly the days the grid marks off, so days off always match what the bid pack prints", () => {
    // The trip starts on day 4 but the grid gives it four days (4-7), longer than its own 2-day schedule span.
    const m = buildDetailedMonth(withGrid(offExcept([4, 5, 6, 7])), START, 28);
    expect(m.summary.daysOff).toBe(24);
    expect(m.summary.printedDaysOff).toBe(24);
    expect(m.days.filter((d) => d.kind !== "off").map((d) => d.dayIndex)).toEqual([4, 5, 6, 7]);
  });

  it("gives the trip the whole stretch of non-off days the grid gives it", () => {
    const m = buildDetailedMonth(withGrid(offExcept([4, 5, 6, 7])), START, 28);
    expect(m.days[4].isTripStart).toBe(true);
    expect(m.days[4].tripDayCount).toBe(4);
    expect(m.days[7].isTripEnd).toBe(true);
    expect(m.days[7].tripDay).toBe(4);
  });

  it("shows days before the first trip starts, when the grid doesn't mark them off, as a trip carried in from the previous period", () => {
    const m = buildDetailedMonth(withGrid(offExcept([0, 1, 4, 5])), START, 28);
    expect(m.days[0].kind).toBe("estimated");
    expect(m.days[0].tripIndex).toBeNull();
    expect(m.days[0].title).toMatch(/previous bid period/);
    expect(m.summary.daysOff).toBe(24);
  });

  it("falls back to laying trips out by their own length when the pack has no grid off days", () => {
    const m = buildDetailedMonth(placed("9001", [4]), START, 28);
    expect(m.days.filter((d) => d.kind !== "off")).toHaveLength(placed("9001", [4]).trips[0].days);
  });
});

describe("the day's route and the trip's landing", () => {
  const leg = (dep: string, arr: string, start: number, opts: Partial<TimelineSegment> = {}, deadhead = false) =>
    ({ kind: deadhead ? "deadhead" : "flying", startMinuteOfDay: start, endMinuteOfDay: start + 120, leg: { dep, arr }, ...opts }) as unknown as TimelineSegment;

  it("prints the day's cities in order, joining hops and marking deadheads, the way the bid pack does", () => {
    const route = dayRoute([leg("PHX", "SEA", 600, {}, true), leg("MEM", "PHX", 450, {}, true), leg("SEA", "LAX", 1200)]);
    expect(route).toEqual([
      { city: "MEM", viaDeadhead: false },
      { city: "PHX", viaDeadhead: true },
      { city: "SEA", viaDeadhead: true },
      { city: "LAX", viaDeadhead: false },
    ]);
  });

  it("leaves out a flight that left the night before — it belongs to that day", () => {
    expect(dayRoute([leg("LAX", "MEM", 0, { continuesFromPreviousDay: true }), leg("MEM", "IAH", 210)])).toEqual([
      { city: "MEM", viaDeadhead: false },
      { city: "IAH", viaDeadhead: false },
    ]);
  });

  it("gives every trip day a route and every trip's last day a landing", () => {
    const m = buildDetailedMonth(placed("9006", [2, 10]), START, 28);
    const tripDays = m.days.filter((d) => d.kind !== "off" && d.kind !== "estimated");
    expect(tripDays.some((d) => d.route.length > 1)).toBe(true);
    const lastDays = m.days.filter((d, i) => d.tripIndex !== null && d.kind !== "off" && m.days[i + 1]?.tripIndex !== d.tripIndex);
    for (const d of lastDays) expect(d.finish?.city).toMatch(/^[A-Z]{3}$/);
  });
});

describe("monthDepartureOptions", () => {
  it("joins trips with the pilot's own hours-at-home rule", () => {
    const o = monthDepartureOptions("MEM", { isCommuter: true, commuteFrom: "SAN", hasCrashPad: false, minHomeHours: 48 });
    expect(o).toMatchObject({ base: "MEM", homeAirports: ["SAN"], hasCrashPad: false, minHomeHours: 48 });
    expect(monthDepartureOptions("MEM", { isCommuter: false, commuteFrom: null, hasCrashPad: null }).minHomeHours).toBeUndefined();
  });
});

describe("chained trips", () => {
  it("joins trips into exactly the departures the scores count, when the base and home are known", () => {
    for (const homeAirports of [["SAN"], []]) {
      const l = placed("9006", [2, 3]);
      const options = { base: SAMPLE_BID_PACK.base, homeAirports };
      const m = buildDetailedMonth(l, START, 28, {}, options);
      expect(m.summary.departures).toBe(groupDepartures(l.trips, { bidPeriodStart: START, base: SAMPLE_BID_PACK.base }, options).length);
      expect(m.days.filter((d) => d.chain).length).toBe(l.trips.length - m.summary.departures);
    }
  });

  it("adds up a commuter's base commutes and nights, says why on the day, and leaves them out for a pilot at base", () => {
    const l = placed("9006", [2, 3]);
    const ctx = { bidPeriodStart: START, base: SAMPLE_BID_PACK.base };
    const options = { base: SAMPLE_BID_PACK.base, homeAirports: ["SAN"] };
    const deps = groupDepartures(l.trips, ctx, options);
    const m = buildDetailedMonth(l, START, 28, {}, options);
    expect(m.summary.base).toEqual({
      code: SAMPLE_BID_PACK.base,
      commutes: deps.reduce((n, d) => n + d.baseCommutes, 0),
      nights: deps.reduce((n, d) => n + d.baseNights.reduce((a, b) => a + b.nights, 0), 0),
      jumpseatIns: deps.reduce((n, d) => n + d.jumpseatIns, 0),
    });
    const noted = m.days.filter((d) => d.baseNote);
    expect(noted.length > 0).toBe(deps.some((d) => d.baseNights.length > 0 || d.jumpseatIns > 0));
    for (const d of noted) expect(d.title).toContain(SAMPLE_BID_PACK.base);
    const local = buildDetailedMonth(l, START, 28, {}, { base: SAMPLE_BID_PACK.base, homeAirports: [] });
    expect(local.summary.base).toBeNull();
    expect(local.days.some((d) => d.baseNote)).toBe(false);
  });

  it("joins a trip that reports within hours of the last one landing at the same base, and counts the run as one departure", () => {
    const m = buildDetailedMonth(placed("9006", [2, 10]), START, 28);
    // Two trips a week apart: no chain, two departures.
    expect(m.days.some((d) => d.chain)).toBe(false);
    expect(m.summary.departures).toBe(2);
  });
});

describe("time at home on the calendar", () => {
  it("says how long the pilot is home between departures, on the day they get home, and counts the short stays", () => {
    // Two trips a week apart: one stay at home between them.
    const l = placed("9006", [2, 10]);
    const m = buildDetailedMonth(l, START, 28, {}, { base: SAMPLE_BID_PACK.base, homeAirports: [] });
    const home = m.summary.home!;
    expect(home.between).toHaveLength(1);
    expect(home.between[0].nights).toBeGreaterThanOrEqual(3);
    expect(home.shortGaps).toBe(0);
    const noted = m.days.filter((d) => d.homeNote);
    expect(noted).toHaveLength(1);
    expect(noted[0].homeNote).toMatch(/^Home for \d+h — \d+ nights in your own bed before leaving again/);
    expect(noted[0].homeNote).not.toMatch(/short of a real break/);
    // The same stay is short for a pilot who needs more nights at home than it gives.
    const strict = buildDetailedMonth(l, START, 28, {}, { base: SAMPLE_BID_PACK.base, homeAirports: [], minBreakNights: home.between[0].nights + 1 });
    expect(strict.summary.home!.shortGaps).toBe(1);
    expect(strict.days.find((d) => d.homeNote)!.homeNote).toMatch(/short of a real break/);
  });

  it("takes the pilot's own number for a real break from their reading", () => {
    const profile = { isCommuter: true, commuteFrom: "SAN", hasCrashPad: false, brainInterview: { reviewedModel: { home: { airports: ["SAN"], commuter: true, minBreakNights: 4 } } } } as never;
    expect(monthDepartureOptions("MEM", profile).minBreakNights).toBe(4);
    expect(monthDepartureOptions("MEM", { isCommuter: false, commuteFrom: null, hasCrashPad: null }).minBreakNights).toBeUndefined();
  });
});
