import { describe, expect, it } from "vitest";
import { buildDetailedMonth, toStripSegment } from "@/lib/month-detail";
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
    const m = buildDetailedMonth(placed("9003", [2]), START, 28);
    expect(m.summary.redEyeDays).toBeGreaterThan(0);
    expect(m.days.filter((d) => d.redEye).length).toBe(m.summary.redEyeDays);
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
