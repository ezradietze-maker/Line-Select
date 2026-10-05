import { describe, expect, it } from "vitest";
import { buildLineMonthCalendar, weekdayFlyingPattern } from "@/lib/line-month";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { Line } from "@/types/bidpack";

const START = "2026-09-28"; // a Monday
const line = (number: string) => SAMPLE_BID_PACK.lines.find((l) => l.lineNumber === number)!;

/** A real sample line with its trip pinned to a real start day, as a parsed pack's grid would. */
function placed(number: string, starts: number[]): Line {
  const l = line(number);
  return { ...l, trips: l.trips.map((t, i) => ({ ...t, startDayIndex: starts[i] })) };
}

function withGrid(number: string, starts: number[], off: number[]): Line {
  const l = placed(number, starts);
  return { ...l, daysOff: off.length, gridOffDays: off };
}

describe("weekdayFlyingPattern", () => {
  it("returns null when the bid pack has no confirmed start date", () => {
    expect(weekdayFlyingPattern(line("9001"), null, 28)).toBeNull();
  });

  it("returns null when the line's own trips aren't placed on real start days", () => {
    const unplaced: Line = { ...line("9001"), trips: line("9001").trips.map((t) => ({ ...t, startDayIndex: null })) };
    expect(weekdayFlyingPattern(unplaced, START, 28)).toBeNull();
  });

  it("counts exactly 4 Mondays in a 28-day period starting on a Monday, all off when the grid says so", () => {
    const offEveryDay = Array.from({ length: 28 }, (_, i) => i);
    const pattern = weekdayFlyingPattern(withGrid("9001", [4], offEveryDay), START, 28)!;
    const monday = pattern.find((p) => p.weekday === "Mon")!;
    expect(monday.totalOccurrences).toBe(4);
    expect(monday.flyingCount).toBe(0);
    expect(pattern.reduce((s, p) => s + p.totalOccurrences, 0)).toBe(28);
  });

  it("counts a real flying day on the target weekday from the grid's own off-day marks, not the trip's own day count", () => {
    // Day 0 = Mon Sep 28. A trip spanning days 4-7 (Fri-Mon) means day 7 is the second Monday.
    const off = Array.from({ length: 28 }, (_, i) => i).filter((i) => i < 4 || i > 7);
    const pattern = weekdayFlyingPattern(withGrid("9001", [4], off), START, 28)!;
    const monday = pattern.find((p) => p.weekday === "Mon")!;
    expect(monday.totalOccurrences).toBe(4);
    expect(monday.flyingCount).toBe(1);
  });

  it("falls back to laying the trip out by its own length when the pack has no grid off days", () => {
    const l = placed("9001", [4]);
    const pattern = weekdayFlyingPattern(l, START, 28)!;
    const totalFlying = pattern.reduce((s, p) => s + p.flyingCount, 0);
    expect(totalFlying).toBe(l.trips[0].days);
  });
});

describe("buildLineMonthCalendar — pre-report days", () => {
  // Trip on days 5..(5 + days - 1); everything else off except the cells under test.
  function gridWith(blank: number[]): Line {
    const days = line("9001").trips[0].days;
    const onTrip = new Set([...Array.from({ length: days }, (_, d) => 5 + d), ...blank]);
    return withGrid("9001", [5], Array.from({ length: 28 }, (_, i) => i).filter((i) => !onTrip.has(i)));
  }

  it("gives the blank day right before a trip to that trip, outside its numbered days", () => {
    const cal = buildLineMonthCalendar(gridWith([4]), START, 28, "local");
    const eve = cal.days[4];
    expect(eve.isOff).toBe(false);
    expect(eve.isPreReport).toBe(true);
    expect(eve.tripIndex).toBe(0);
    expect(eve.tripDayNumber).toBeNull();
    // The trip's own Day 1 is still its real start day.
    expect(cal.days[5].tripDayNumber).toBe(1);
    expect(cal.days[5].isPreReport).toBeFalsy();
  });

  it("still treats a blank day with no trip right after it as carried in from last month", () => {
    const cal = buildLineMonthCalendar(gridWith([0]), START, 28, "local");
    expect(cal.days[0].isPreReport).toBeFalsy();
    expect(cal.days[0].tripIndex).toBeNull();
  });
});
