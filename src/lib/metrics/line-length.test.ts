import { describe, expect, it } from "vitest";
import { lineLengthDays, perMonthFactor } from "@/lib/metrics/line-length";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import { scorePackV2 } from "@/lib/scoring-v2/score";
import type { BidPack, Line } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

const START = "2026-09-28";
const ctx = { bidPeriodStart: START, bidPeriodDays: 28, base: SAMPLE_BID_PACK.base };
/** A real sample line with its trips pinned to start days, as a parsed pack's grid would. */
function placed(number: string, starts: number[], id = number): Line {
  const l = SAMPLE_BID_PACK.lines.find((x) => x.lineNumber === number)!;
  return { ...l, id, lineNumber: id, trips: l.trips.map((t, i) => ({ ...t, startDayIndex: starts[i] })) };
}
const lastTrip = (l: Line) => l.trips[l.trips.length - 1];

describe("a line's own month length", () => {
  it("is the bid month for a line that stays inside it", () => {
    expect(lineLengthDays(placed("9006", [2, 10]), ctx)).toBe(28);
    expect(perMonthFactor(placed("9006", [2, 10]), ctx)).toBe(1);
  });

  it("runs to the last landing for a line whose last trip carries over into the fifth week", () => {
    const l = placed("9006", [2, 27]);
    expect(lastTrip(l).days).toBeGreaterThan(1);
    const days = lineLengthDays(l, ctx);
    expect(days).toBeGreaterThan(28);
    expect(days).toBeLessThan(27 + lastTrip(l).days + 1);
    expect(perMonthFactor(l, ctx)).toBeCloseTo(28 / days, 10);
  });

  it("is the bid period itself without real dates", () => {
    expect(lineLengthDays(placed("9006", [2, 27]), { ...ctx, bidPeriodStart: null })).toBe(28);
  });

  it("judges a five-week line's departures at their four-week equivalent, and still shows the real count", () => {
    const four = placed("9006", [2, 10], "four");
    const five = placed("9006", [2, 27], "five");
    const pack = { ...SAMPLE_BID_PACK, bidPeriodStart: START, bidPeriodDays: 28, lines: [four, five] } as BidPack;
    const model: PilotModel = {
      version: 2, home: null, threads: [], notMeasurable: [], synopsis: "",
      criteria: [{ id: "d", metric: "homeDepartures", label: "Few departures", shape: { kind: "less", fineAt: 1, worstAt: 3 }, tier: "high", weight: 1, confidence: 1, evidence: [], status: "settled" }],
    };
    const [a, b] = scorePackV2(pack, model);
    expect(a.results[0].value).toBe(b.results[0].value); // the same number of departures, as counted
    expect(b.results[0].utility).toBeGreaterThan(a.results[0].utility); // but spread over a longer month
  });
});
