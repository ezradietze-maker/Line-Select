import { describe, expect, it } from "vitest";
import { averageBlg, blockOverrideEstimate, BLOCK_OVERRIDE_ON, lineTotal, payOnlyOrder, totalDiffers } from "@/lib/pay/line-total";
import type { BidPack, Line, Trip } from "@/types/bidpack";

/** A trip whose duties fly these block hours. */
const trip = (...dutyBlock: number[]): Trip =>
  ({ schedule: dutyBlock.map((b) => ({ legs: [], totals: { blockHours: b, creditHours: b } })) }) as unknown as Trip;
const line = (id: string, credit: number, carryOver = 0, trips: Trip[] = []): Line =>
  ({ id, lineNumber: id, totalCreditHours: credit, carryOverCreditHours: carryOver, trips }) as unknown as Line;
const fourWeeks = { bidPeriodDays: 28 };
const sum = (parts: { ch: number }[]) => parts.reduce((a, p) => a + p.ch, 0);

describe("a line's Total CH", () => {
  it("is what the pack prints when nothing happens to the line: this month's credit and its C/O", () => {
    const t = lineTotal(fourWeeks, line("1", 78.5, 6.25));
    expect(t.total).toBe(84.75);
    expect(t.thisMonth).toBe(78.5);
    expect(t.parts.map((p) => p.id)).toEqual(["printed", "carryOver"]);
    expect(totalDiffers(line("1", 78.5, 6.25), t)).toBe(false);
  });

  it("raises a line under the minimum to the 68:00 a 4-week bid period guarantees (4.A.1.a)", () => {
    const t = lineTotal(fourWeeks, line("1", 64));
    expect(t.total).toBe(68);
    expect(t.parts.find((p) => p.id === "buyUp")).toMatchObject({ ch: 4, section: "4.A.1.a" });
    expect(lineTotal({ bidPeriodDays: 35 }, line("1", 80)).total).toBe(85);
  });

  it("takes off what a carry-in drops, and keeps the line's C/O as it prints, the parts adding up to the total", () => {
    const printed = line("1", 80, 5);
    const t = lineTotal(fourWeeks, printed, { totalCreditHours: 70, carryOverCreditHours: 5, trips: [] });
    expect(t.total).toBe(75);
    expect(t.parts.find((p) => p.id === "carryIn")!.ch).toBe(-10);
    expect(sum(t.parts)).toBeCloseTo(t.total, 9);
    expect(totalDiffers(printed, t)).toBe(true);
  });

  it("raises to the minimum before a carry-in comes off, as 4.B floors the line as awarded", () => {
    const t = lineTotal(fourWeeks, line("1", 66), { totalCreditHours: 60, carryOverCreditHours: 0, trips: [] });
    expect(t.total).toBe(62);
    expect(sum(t.parts)).toBeCloseTo(62, 9);
  });

  it("still counts trips a vacation takes off, paid from the bank, and says how much", () => {
    const t = lineTotal(fourWeeks, line("1", 80), null, 12.5);
    expect(t.total).toBe(80);
    expect(t.fromVacationBank).toBe(12.5);
  });

  it("works out block override from duties over 8 block hours, up to 2 each, without counting it yet", () => {
    expect(blockOverrideEstimate({ trips: [trip(7.5, 8.5, 11.25)] })).toBe(2.5);
    const t = lineTotal(fourWeeks, line("1", 80, 0, [trip(9)]));
    expect(t.blockOverrideEstimate).toBe(1);
    expect(BLOCK_OVERRIDE_ON).toBe(false);
    expect(t.total).toBe(80);
    expect(t.parts.some((p) => p.id === "blockOverride")).toBe(false);
  });
});

describe("a bid for pay only", () => {
  const pack = (lines: Line[], rlg: number | null = 75): Pick<BidPack, "bidPeriodDays" | "lines" | "info"> =>
    ({ bidPeriodDays: 28, lines, info: rlg === null ? undefined : { rlgHours: rlg } }) as Pick<BidPack, "bidPeriodDays" | "lines" | "info">;

  it("takes the average BLG over the lines as 4.B floors them", () => {
    expect(averageBlg(pack([line("1", 80), line("2", 60)]))).toBe(74); // 80 and 68
  });

  it("orders by Total CH and marks where a secondary and a reserve line would pay as much", () => {
    const lines = [line("1", 70), line("2", 84), line("3", 76, 4), line("4", 72)];
    const totals = new Map(lines.map((l) => [l.id, lineTotal(fourWeeks, l)]));
    const p = payOnlyOrder(pack(lines), totals);
    expect(p.order).toEqual(["2", "3", "4", "1"]);
    expect(p.averageBlg).toBe(75.5);
    expect(p.aboveAverage).toBe(2); // 84 and 80 pay more than a secondary's 75:30
    expect(p.aboveReserve).toBe(2); // 72 and 70 pay less than the 75:00 RLG
  });

  it("follows the pilot's carry-in, which changes what each line pays", () => {
    const lines = [line("1", 80), line("2", 78)];
    const totals = new Map([
      ["1", lineTotal(fourWeeks, lines[0], { totalCreditHours: 70, carryOverCreditHours: 0, trips: [] })],
      ["2", lineTotal(fourWeeks, lines[1])],
    ]);
    expect(payOnlyOrder(pack(lines, null), totals)).toMatchObject({ order: ["2", "1"], aboveReserve: null });
  });
});
