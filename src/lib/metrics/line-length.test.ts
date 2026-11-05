import { describe, expect, it } from "vitest";
import { fourWeekFactor, lineLengthDays } from "@/lib/metrics/line-length";
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
  });

  it("runs to the last landing for a line whose last trip carries over into the fifth week", () => {
    const l = placed("9006", [2, 27]);
    expect(lastTrip(l).days).toBeGreaterThan(1);
    const days = lineLengthDays(l, ctx);
    expect(days).toBeGreaterThan(28);
    expect(days).toBeLessThan(27 + lastTrip(l).days + 1);
  });

  it("is the bid period itself without real dates", () => {
    expect(lineLengthDays(placed("9006", [2, 27]), { ...ctx, bidPeriodStart: null })).toBe(28);
  });

  it("judges a five-week bid month's departures at four weeks' worth, and still shows the real count", () => {
    expect(fourWeekFactor({ bidPeriodDays: 28 })).toBe(1);
    expect(fourWeekFactor({ bidPeriodDays: 35 })).toBe(0.8);
    const line = placed("9006", [2, 10], "a");
    const model: PilotModel = {
      version: 2, home: null, threads: [], notMeasurable: [], synopsis: "",
      criteria: [{ id: "d", metric: "homeDepartures", label: "Few departures", shape: { kind: "less", fineAt: 1, worstAt: 3 }, tier: "high", weight: 1, confidence: 1, evidence: [], status: "settled" }],
    };
    const month = (days: number) => scorePackV2({ ...SAMPLE_BID_PACK, bidPeriodStart: START, bidPeriodDays: days, lines: [line, { ...line, id: "b" }] } as BidPack, model)[0].results[0];
    expect(month(35).value).toBe(month(28).value); // the same number of departures, as counted
    expect(month(35).value).toBe(2);
  });

  it("leaves what a line's last trip carries into the next month out of its month: a commuter's way home is next month's", () => {
    const four = placed("9006", [2, 10], "four");
    const five = placed("9006", [2, 27], "five");
    const pack = { ...SAMPLE_BID_PACK, bidPeriodStart: START, bidPeriodDays: 28, lines: [four, five] } as BidPack;
    const model: PilotModel = {
      version: 2, home: { airports: ["DEN"] } as PilotModel["home"], threads: [], notMeasurable: [], synopsis: "",
      criteria: [{ id: "c", metric: "departureCommutes", label: "Few commutes", shape: { kind: "less", fineAt: 0, worstAt: 4 }, tier: "high", weight: 1, confidence: 1, evidence: [], status: "settled" }],
    };
    const [a, b] = scorePackV2(pack, model);
    expect(b.results[0].value).toBe(a.results[0].value! - 1);
  });
});
