import { describe, expect, it } from "vitest";
import { computeBidPackGroundingStats } from "@/lib/interview-grounding";
import { computeImplicitLineValues } from "@/lib/implicit-dimensions";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { BidPack } from "@/types/bidpack";

/** The sample pack with a real start date and grid day-off marks, as a parsed pack carries them. */
function packWithCalendar(): BidPack {
  return {
    ...SAMPLE_BID_PACK,
    bidPeriodStart: "2026-09-28",
    lines: SAMPLE_BID_PACK.lines.map((l, i) => ({
      ...l,
      // Line 0: one 6-day block incl. a weekend; others: scattered singles.
      gridOffDays: i === 0 ? [0, 1, 2, 3, 4, 5] : [1, 3, 9, 15],
    })),
  };
}

describe("computeBidPackGroundingStats", () => {
  it("gives the interview the pack's real days-off spread and dates", () => {
    const g = computeBidPackGroundingStats(packWithCalendar());
    const daysOff = SAMPLE_BID_PACK.lines.map((l) => l.daysOff);
    expect(g.daysOff).toEqual({ min: Math.min(...daysOff), max: Math.max(...daysOff) });
    expect(g.bidPeriod).toEqual({ start: "2026-09-28", end: "2026-10-25", days: SAMPLE_BID_PACK.bidPeriodDays });
    expect(g.daysOffBlock).toEqual({ min: 1, max: 6 });
    expect(g.weekendDaysOff).toMatchObject({ min: 0, max: 1, weekendDaysInPeriod: 8 });
  });

  it("averages credit per days-off count, so a pay-for-days trade uses real numbers", () => {
    const g = computeBidPackGroundingStats(SAMPLE_BID_PACK);
    const total = g.creditByDaysOff!.reduce((s, r) => s + r.lines, 0);
    expect(total).toBe(SAMPLE_BID_PACK.lines.length);
    expect(g.creditByDaysOff!.map((r) => r.daysOff)).toEqual([...g.creditByDaysOff!.map((r) => r.daysOff)].sort((a, b) => a - b));
  });

  it("says the calendar shape is unknown, not zero, without a start date or grid marks", () => {
    const g = computeBidPackGroundingStats(SAMPLE_BID_PACK);
    expect(g.bidPeriod).toBeNull();
    expect(g.weekendDaysOff).toBeNull();
  });
});

describe("calendar implicit dimensions", () => {
  it("scores the line with days off in one block highest on days-off-together", () => {
    const pack = packWithCalendar();
    const values = computeImplicitLineValues(pack);
    expect(values[pack.lines[0].id].longestDaysOffBlockPerLine).toBe(1);
    expect(values[pack.lines[1].id].longestDaysOffBlockPerLine).toBe(0);
  });
});

describe("computeBidPackGroundingStats — what a calendar hard line costs", () => {
  it("counts the lines that never work each weekday and are off each date", () => {
    // Trips placed on real days, as a parsed pack's are — without placement there's no calendar to count.
    const pack = packWithCalendar();
    const placed = { ...pack, lines: pack.lines.map((l) => ({ ...l, trips: l.trips.map((t) => ({ ...t, startDayIndex: 6 })) })) };
    const g = computeBidPackGroundingStats(placed);
    expect(g.linesFree?.linesWithCalendar).toBe(placed.lines.length);
    expect(Object.keys(g.linesFree!.byWeekday).sort()).toEqual(["Fri", "Mon", "Sat", "Sun", "Thu", "Tue", "Wed"]);
    expect(Object.keys(g.linesFree!.byDate)).toHaveLength(SAMPLE_BID_PACK.bidPeriodDays);
    // Day 0 (2026-09-28) is off on line 0 only — its 6-day block — and the other lines' first day off is day 1.
    expect(g.linesFree!.byDate["2026-09-28"]).toBe(1);
  });
});
