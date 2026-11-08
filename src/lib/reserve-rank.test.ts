import { describe, expect, it } from "vitest";
import { rankReserveLines } from "@/lib/reserve-rank";
import type { BidPack } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

// 2026-09-28 is a Monday: offsets 5, 6, 12, 13, 19, 20, 26, 27 are the weekend days of this 28-day period.
const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const pack: Pick<BidPack, "reserveLines" | "bidPeriodDays" | "bidPeriodStart"> = {
  bidPeriodDays: 28,
  bidPeriodStart: "2026-09-28",
  reserveLines: [
    // Three broken-up blocks: 15 R-days, longest run off 5, standing two weekends.
    { lineNumber: "7001", reserveType: "a", days: [...days(0, 4), ...days(10, 14), ...days(20, 24)] },
    // 15 R-days in one block: 13 off in a row, all at the month's end.
    { lineNumber: "7002", reserveType: "b", days: days(0, 14) },
    // 15 R-days, every one a weekday, and it runs two days past the period.
    { lineNumber: "7003", reserveType: "24hr", days: [...days(7, 11), ...days(14, 18), ...days(21, 25), 28, 29] },
  ],
};

function modelWith(metrics: { metric: string; weight: number; dates?: string[] }[]): PilotModel {
  return { criteria: metrics.map((m, i) => ({ id: `c${i}`, metric: m.metric, weight: m.weight, params: m.dates ? { dates: m.dates } : undefined })) } as unknown as PilotModel;
}

describe("rankReserveLines", () => {
  it("reads each line's days off, matching a hand count", () => {
    const byLine = Object.fromEntries(rankReserveLines(pack, {}).map((l) => [l.lineNumber, l]));
    expect(byLine["7001"]).toMatchObject({ rDays: 15, daysOff: 13, longestOff: 5, weekendDaysOff: 5, carryOverDays: 0 });
    expect(byLine["7002"]).toMatchObject({ rDays: 15, daysOff: 13, longestOff: 13, weekendDaysOff: 4, carryOverDays: 0 });
    expect(byLine["7003"]).toMatchObject({ rDays: 15, daysOff: 13, longestOff: 7, weekendDaysOff: 8, carryOverDays: 2 });
  });

  it("puts the longest stretch first for a pilot who cares about it, the weekends first for one who cares about those", () => {
    expect(rankReserveLines(pack, { model: modelWith([{ metric: "longestDaysOffBlock", weight: 1 }]) })[0].lineNumber).toBe("7002");
    expect(rankReserveLines(pack, { model: modelWith([{ metric: "weekendDaysOff", weight: 1 }]) })[0].lineNumber).toBe("7003");
  });

  it("puts a commuter on the line with 24 hours' notice", () => {
    const ranked = rankReserveLines(pack, { model: modelWith([{ metric: "longestDaysOffBlock", weight: 1 }]), isCommuter: true });
    expect(ranked[0].lineNumber).toBe("7003");
    expect(ranked[0].reason).toContain("24 hours' notice");
  });

  it("sends a line standing a needed date to the bottom and says so", () => {
    // Oct 1 is offset 3: only 7003 is off that day.
    const ranked = rankReserveLines(pack, { model: modelWith([{ metric: "requestedDatesWorked", weight: 1, dates: ["2026-10-01"] }]) });
    expect(ranked[0].lineNumber).toBe("7003");
    expect(ranked[2].neededDatesOnCall).toEqual(["2026-10-01"]);
    expect(ranked[2].reason).toContain("a date you need");
  });

  it("still gives an order on a pack saved before days were read: by line number, and the commuter's R-24 first", () => {
    const old = { ...pack, reserveLines: pack.reserveLines!.map(({ lineNumber, reserveType }) => ({ lineNumber, reserveType })) };
    expect(rankReserveLines(old, {}).map((l) => l.lineNumber)).toEqual(["7001", "7002", "7003"]);
    expect(rankReserveLines(old, { isCommuter: true })[0].lineNumber).toBe("7003");
    expect(rankReserveLines(old, {})[0].daysOff).toBeNull();
  });

  it("is empty for a pack with no reserve lines", () => {
    expect(rankReserveLines({ ...pack, reserveLines: undefined }, {})).toEqual([]);
  });
});
