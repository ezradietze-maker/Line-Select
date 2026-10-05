import { describe, expect, it } from "vitest";
import { dateOfDayIndex, longestDaysOffBlock, weekendDaysOff } from "@/lib/days-off-pattern";
import type { Line } from "@/types/bidpack";

const START = "2026-09-28"; // a Monday, so days 5/6, 12/13, 19/20, 26/27 are the weekends

function line(gridOffDays: number[] | undefined, estimated = false): Line {
  return {
    id: "l", lineNumber: "1", trips: [], daysOff: gridOffDays?.length ?? 0, totalCreditHours: 0, totalTafbHours: 0,
    totalLandings: 0, totalDepartures: 0, gridOffDays, estimated,
  };
}

describe("longestDaysOffBlock", () => {
  it("finds the longest consecutive run, regardless of order", () => {
    expect(longestDaysOffBlock(line([20, 1, 2, 10, 11, 12, 13, 3]))).toBe(4);
  });
  it("is null without the grid's own day-off marks, never a guess", () => {
    expect(longestDaysOffBlock(line(undefined))).toBeNull();
    expect(longestDaysOffBlock(line([1, 2], true))).toBeNull();
  });
  it("is 0 for a line with no days off at all", () => {
    expect(longestDaysOffBlock(line([]))).toBe(0);
  });
});

describe("weekendDaysOff", () => {
  it("counts only Saturdays and Sundays off on the real calendar", () => {
    expect(weekendDaysOff(line([4, 5, 6, 7, 12]), START)).toBe(3);
  });
  it("is null without a real bid-period start", () => {
    expect(weekendDaysOff(line([5, 6]), null)).toBeNull();
  });
});

describe("dateOfDayIndex", () => {
  it("maps a day index to its real date, across a month boundary", () => {
    expect(dateOfDayIndex(START, 0)).toBe("2026-09-28");
    expect(dateOfDayIndex(START, 3)).toBe("2026-10-01");
  });
});
