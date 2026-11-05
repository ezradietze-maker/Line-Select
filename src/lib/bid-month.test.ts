import { describe, expect, it } from "vitest";
import { bidMonthEnd, bidMonthName, lineCarryOver, monthLine, nextMonthName, uncutTrip } from "@/lib/bid-month";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { Line } from "@/types/bidpack";

// The October bid month: four weeks from Monday September 28, Memphis time.
const ctx = { bidPeriodStart: "2026-09-28", bidPeriodDays: 28, base: SAMPLE_BID_PACK.base };
/** Sample line 9006 — trip 502 (two duties, 2 days) and 503 (MEM–HNL, then HNL–MEM the next afternoon) — on these days. */
function placed(starts: number[], extra: Partial<Line> = {}): Line {
  const l = SAMPLE_BID_PACK.lines.find((x) => x.lineNumber === "9006")!;
  return { ...l, totalDutyPeriods: 4, ...extra, trips: l.trips.map((t, i) => ({ ...t, startDayIndex: starts[i] })) };
}

describe("the bid month", () => {
  it("ends at midnight on the base's clock after its last day, and is named for the month most of it falls in", () => {
    expect(new Date(bidMonthEnd(ctx)!).toISOString()).toBe("2026-10-26T05:00:00.000Z");
    expect(bidMonthName(ctx)).toBe("October");
    expect(nextMonthName(ctx)).toBe("November");
    expect(nextMonthName({ ...ctx, bidPeriodDays: 35 })).toBe("November");
    expect(bidMonthEnd({ ...ctx, bidPeriodStart: null })).toBeNull();
  });

  it("leaves a line that stays inside its month as it is", () => {
    const line = placed([2, 10]);
    expect(monthLine(line, ctx)).toBe(line);
    expect(lineCarryOver(line, ctx)).toBeNull();
  });

  it("cuts the last trip at the month's end: a duty belongs to the month it reports in", () => {
    // 503 reports 11:00 on Sunday October 25; its second duty reports Monday afternoon — November's.
    const line = placed([2, 27], { carryOverCreditHours: 4, carryOverBlockHours: 9 });
    const month = monthLine(line, ctx);
    const carry = lineCarryOver(line, ctx)!;
    expect(carry).toMatchObject({ month: "November", days: 2, dutyPeriods: 1, landings: 1, creditHours: 4, printedBlockHours: 9, trips: ["503"] });
    const cut = month.trips[1];
    expect(cut.carriesIntoNextMonth).toBe(true);
    expect(cut.schedule).toHaveLength(1);
    expect(cut.creditHours).toBe(18 - 4); // the pack's C/O is what the trip carries
    expect(cut.tafbHours).toBeCloseTo(44 - carry.tafbHours, 6);
    expect(uncutTrip(cut)).toBe(line.trips[1]);
    // The pack's own counts, less what's carried; credit, block and TAFB are already the month's as printed.
    expect(month.totalLandings).toBe(line.totalLandings - 1);
    expect(month.totalDutyPeriods).toBe(3);
    expect(month.totalCreditHours).toBe(line.totalCreditHours);
    expect(month.carryOverCreditHours).toBe(4);
  });

  it("leaves estimated lines alone — nothing about their trips' dates is known", () => {
    const line = placed([2, 27], { estimated: true });
    expect(monthLine(line, ctx)).toBe(line);
  });
});
