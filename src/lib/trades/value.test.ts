import { describe, expect, it } from "vitest";
import { sortedTrips } from "@/lib/trades/legality";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import { rankLinesWithTrips } from "@/lib/scoring-v2/trip-score";
import { swappedLine, valueSwaps } from "@/lib/trades/value";
import type { Criterion, PilotModel } from "@/types/pilot-model";

const credit = (kind: "more" | "less"): Criterion => ({ id: "c", metric: "creditHours", shape: { kind }, tier: "high", weight: 1, confidence: 1, label: "Credit", evidence: [], status: "settled" }) as unknown as Criterion;
const model = (kind: "more" | "less"): PilotModel => ({ version: 2, home: null, criteria: [credit(kind)], threads: [], notMeasurable: [], synopsis: "" }) as PilotModel;

const pack = SAMPLE_BID_PACK;
const line = pack.lines.find((l) => l.trips.length >= 2)!;
const give = sortedTrips(line)[0];
const take = { ...give, id: "bigger", creditHours: give.creditHours + 6, tafbHours: give.tafbHours + 12, landings: give.landings + 1, departures: give.departures + 1 };

describe("a line after a swap", () => {
  it("moves its totals by the difference between the trips", () => {
    const s = swappedLine(line, give, take, "x");
    expect(s.totalCreditHours).toBeCloseTo(line.totalCreditHours + 6);
    expect(s.totalTafbHours).toBeCloseTo(line.totalTafbHours + 12);
    expect(s.totalLandings).toBe(line.totalLandings + 1);
    expect(s.trips).toHaveLength(line.trips.length);
    expect(s.trips).toContain(take);
    expect(s.trips).not.toContain(give);
  });

  it("gains or loses days off by what the trips touch", () => {
    const three = { ...give, startDayIndex: 3, days: 3 };
    const dated = { ...line, daysOff: 20, trips: [three], gridOffDays: [0, 1, 2, 6, 7] };
    const after = swappedLine(dated, three, { ...three, id: "short", days: 2 }, "x");
    expect(after.daysOff).toBe(21);
    expect(after.gridOffDays).toEqual([0, 1, 2, 5, 6, 7]);
  });
});

describe("what a swap is worth", () => {
  it("is judged by the pilot's own priorities: the same swap can suit one and not another", () => {
    const [wantsMore] = valueSwaps(pack, line, model("more"), [{ give, take }]);
    const [wantsLess] = valueSwaps(pack, line, model("less"), [{ give, take }]);
    expect(wantsMore.gain).toBeGreaterThan(0);
    expect(wantsLess.gain).toBeLessThan(0);
    expect(wantsMore.creditChange).toBeCloseTo(6);
  });

  it("starts from the same score the pilot's rankings show", () => {
    const [v] = valueSwaps(pack, line, model("more"), [{ give, take }]);
    const shown = rankLinesWithTrips(pack, model("more")).find((s) => s.lineId === line.id)!;
    expect(v.before).toBeCloseTo(shown.score, 1);
  });

  it("says what moved", () => {
    const [v] = valueSwaps(pack, line, model("more"), [{ give, take }]);
    expect(v.reasons[0]).toMatchObject({ label: "Credit", better: true });
    expect(v.reasons[0].to).toBeGreaterThan(v.reasons[0].from!);
  });

  it("doesn't let a pile of hypothetical lines move the pack's scale", () => {
    const one = valueSwaps(pack, line, model("more"), [{ give, take }])[0];
    const many = valueSwaps(pack, line, model("more"), Array.from({ length: 50 }, () => ({ give, take })))[0];
    expect(many.after).toBe(one.after);
  });
});
