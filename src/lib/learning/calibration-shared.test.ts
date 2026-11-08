import { describe, expect, it } from "vitest";
import { calibrationReport } from "@/lib/learning/calibration-report";
import { awardsBehind, MIN_AWARDS, pairsOfCase, testCalibration, type CalibrationCase } from "@/lib/learning/fair-test";
import { baselineBrier, brierScore, pairsFromHolders, reliabilityTable } from "@/lib/learning/forecast-learning";
import { calibrationCasesFrom } from "@/lib/server/learning-store";

const prediction = (bidNumber: number) => ({ ranking: [0, 1, 2, 3], pAvailable: [0.1, 0.4, 0.6, 0.9], bidNumber });
const seeded = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
};

describe("what other pilots' awards say about a forecast", () => {
  it("a line was open for anyone ahead of its holder and gone for anyone behind", () => {
    const holders = [{ lineIndex: 1, bidPosition: 20 }];
    expect(pairsFromHolders(prediction(10), holders)).toEqual([{ p: 0.4, y: 1 }]);
    expect(pairsFromHolders(prediction(30), holders)).toEqual([{ p: 0.4, y: 0 }]);
  });

  it("says nothing about a line the pilot didn't rank, or their own place", () => {
    expect(pairsFromHolders(prediction(10), [{ lineIndex: 9, bidPosition: 20 }])).toEqual([]);
    expect(pairsFromHolders(prediction(20), [{ lineIndex: 1, bidPosition: 20 }])).toEqual([]);
  });

  it("needs to know where the pilot was in bid order", () => {
    expect(pairsFromHolders({ ranking: [1], pAvailable: [0.5] }, [{ lineIndex: 1, bidPosition: 20 }])).toEqual([]);
  });

  it("leaves lines the pilot's own award already settled to that award, so none is counted twice", () => {
    const c: CalibrationCase = { prediction: prediction(10), award: { outcome: "line", lineIndex: 1 }, holders: [{ lineIndex: 0, bidPosition: 5 }, { lineIndex: 3, bidPosition: 20 }] };
    // Own award: line 0 gone, line 1 open. Others: line 3 held behind them, so open.
    expect(pairsOfCase(c)).toEqual([{ p: 0.1, y: 0 }, { p: 0.4, y: 1 }, { p: 0.9, y: 1 }]);
  });

  it("adds nothing to a reserve award, which already settles the whole ranking", () => {
    const c: CalibrationCase = { prediction: prediction(10), award: { outcome: "reserve", lineIndex: null }, holders: [{ lineIndex: 1, bidPosition: 20 }] };
    expect(pairsOfCase(c)).toHaveLength(4);
    expect(pairsOfCase(c).every((x) => x.y === 0)).toBe(true);
  });
});

describe("the numbers on the admin view", () => {
  it("scores a perfect forecast 0, and a coin toss 0.25", () => {
    expect(brierScore([{ p: 1, y: 1 }, { p: 0, y: 0 }])).toBe(0);
    expect(brierScore([{ p: 0.5, y: 1 }, { p: 0.5, y: 0 }])).toBe(0.25);
    expect(baselineBrier([{ p: 0.5, y: 1 }, { p: 0.5, y: 0 }])).toBe(0.25);
  });

  it("puts each number in its bin, against what happened", () => {
    const table = reliabilityTable([{ p: 0.15, y: 0 }, { p: 0.12, y: 1 }, { p: 0.95, y: 1 }, { p: 1, y: 1 }]);
    expect(table).toHaveLength(2);
    expect(table[0]).toMatchObject({ from: 0.1, n: 2, happened: 0.5 });
    expect(table[0].said).toBeCloseTo(0.135);
    expect(table[1]).toMatchObject({ n: 2, happened: 1 });
  });

  it("finds a forecast honest when it is, and too hopeful when it's too hopeful", () => {
    const random = seeded(7);
    const honest = Array.from({ length: 20000 }, () => {
      const p = random();
      return { p, y: (random() < p ? 1 : 0) as 0 | 1 };
    });
    for (const bin of reliabilityTable(honest)) expect(Math.abs(bin.said - bin.happened)).toBeLessThan(0.04);
    expect(brierScore(honest)).toBeLessThan(baselineBrier(honest));

    const hopeful = honest.map((x) => ({ p: x.p, y: (random() < x.p * 0.5 ? 1 : 0) as 0 | 1 }));
    for (const bin of reliabilityTable(hopeful).slice(5)) expect(bin.said - bin.happened).toBeGreaterThan(0.15);
  });

  it("reports counts and scores from cases, with no hash or line in it", () => {
    const report = calibrationReport(
      [
        { seat: "CAP", packKey: "a", prediction: prediction(10), award: { outcome: "line", lineIndex: 1 }, awardId: "x", holders: [{ lineIndex: 3, bidPosition: 20, id: "y" }] },
        { seat: "FO", packKey: "b", prediction: prediction(10), award: null, holders: [{ lineIndex: 3, bidPosition: 5, id: "z" }] },
      ],
      null,
      new Date(0)
    );
    expect(report).toMatchObject({ awards: 3, forecasts: 2, packs: 2, pairs: { ownAward: 2, otherPilots: 2 } });
    expect(report.bySeat.map((s) => s.seat)).toEqual(["CAP", "FO"]);
    expect(report.fairTest.ready).toBe(false);
    expect(JSON.stringify(report)).not.toMatch(/hash|lineIndex|bidPosition/);
  });
});

describe("the fair test with shared awards", () => {
  /** A month's forecasts that say `said` for each line. Each line really is open at each turn about `real` of the time. */
  const pack = (month: number, forecasts: number, said: number, real: number): CalibrationCase[] => {
    const random = seeded(month + 1);
    const holders = Array.from({ length: 6 }, (_, i) => ({ lineIndex: i, id: `${month}-${i}`, bidPosition: 0 }));
    return Array.from({ length: forecasts }, (_, f) => {
      const bidNumber = 100 + f;
      return {
        packKey: `m${month}`,
        prediction: { ranking: holders.map((h) => h.lineIndex), pAvailable: holders.map(() => said), bidNumber },
        award: null,
        holders: holders.map((h) => ({ ...h, bidPosition: random() < real ? bidNumber + 1 : bidNumber - 1 })),
      };
    });
  };

  it("counts one award once, however many forecasts it checks", () => {
    const cases = Array.from({ length: 200 }, (_, i): CalibrationCase => ({ packKey: "one", prediction: prediction(i + 2), award: null, holders: [{ lineIndex: 1, bidPosition: 1, id: "only" }] }));
    expect(awardsBehind(cases)).toBe(1);
    expect(testCalibration(cases, "fc", new Date(0))).toMatchObject({ ready: false, reason: `1 checked awards so far — needs ${MIN_AWARDS}` });
  });

  it("won't judge a pack with its own awards", () => {
    const cases = pack(0, 12, 0.9, 0.3);
    expect(awardsBehind(cases)).toBe(6);
    const big = Array.from({ length: 40 }, (_, i): CalibrationCase => ({ packKey: "only", prediction: prediction(i + 2), award: null, holders: [{ lineIndex: 1, bidPosition: 1, id: `a${i}` }] }));
    expect(testCalibration(big, "fc", new Date(0))).toMatchObject({ ready: false, reason: expect.stringContaining("one pack") });
  });

  it("corrects forecasts that were too hopeful, learning from older months and judged on newer ones", () => {
    const cases = Array.from({ length: 8 }, (_, m) => pack(m, 10, 0.9, 0.3)).flat();
    const t = testCalibration(cases, "fc", new Date(0));
    if (!t.ready) throw new Error(t.reason);
    expect(t.promote).toBe(true);
    expect(t.brierChallenger).toBeLessThan(t.brierUncalibrated);
  });

  it("leaves a forecast alone when it was right", () => {
    const cases = Array.from({ length: 8 }, (_, m) => pack(m, 10, 0.3, 0.3)).flat();
    const t = testCalibration(cases, "fc", new Date(0));
    if (!t.ready) throw new Error(t.reason);
    expect(t.promote).toBe(false);
  });
});

describe("putting forecasts next to awards", () => {
  const at = (n: number) => new Date(2026, 0, n);
  const award = (over: Partial<Parameters<typeof calibrationCasesFrom>[0][number]>) => ({ id: "a", pilotHash: "A", packKey: "oct", seat: "CAP", outcome: "line", lineNumber: "L1", seniorityRank: 20, holderShown: true, submittedAt: at(1), ...over });
  const forecast = (over: Partial<Parameters<typeof calibrationCasesFrom>[1][number]>) => ({ pilotHash: "B", blobKey: "blob", packKey: "oct", bidNumber: 10, ranking: [0, 1, 2], pAvailable: [0.2, 0.5, 0.8], ...over });
  const lines = new Map([["blob", ["L0", "L1", "L2"]]]);

  it("checks a pilot's forecast against another pilot's award", () => {
    const [c] = calibrationCasesFrom([award({})], [forecast({})], lines);
    expect(c.award).toBeNull();
    expect(c.holders).toEqual([{ lineIndex: 1, bidPosition: 20, id: "a" }]);
    expect(pairsOfCase(c)).toEqual([{ p: 0.5, y: 1 }]);
  });

  it("doesn't use a pilot's own row as someone else's, and matches their own award", () => {
    const [c] = calibrationCasesFrom([award({ pilotHash: "B", seniorityRank: 10 })], [forecast({})], lines);
    expect(c.award).toEqual({ outcome: "line", lineIndex: 1 });
    expect(c.holders).toEqual([]);
  });

  it("won't use a report as a holder unless the pilot agreed, since only then is its place exact", () => {
    expect(calibrationCasesFrom([award({ holderShown: false })], [forecast({})], lines)).toEqual([]);
  });

  it("ignores another pack's awards, and a withdrawn award simply isn't there", () => {
    expect(calibrationCasesFrom([award({ packKey: "nov" })], [forecast({})], lines)).toEqual([]);
    expect(calibrationCasesFrom([], [forecast({})], lines)).toEqual([]);
  });

  it("carries no hash into the case, and keeps a pack's forecasts together, oldest pack first", () => {
    const awards = [award({ id: "n", packKey: "nov", submittedAt: at(9) }), award({ id: "o", packKey: "oct", submittedAt: at(2) })];
    const forecasts = [forecast({ packKey: "nov", pilotHash: "B" }), forecast({ packKey: "oct", pilotHash: "C" }), forecast({ packKey: "nov", pilotHash: "D" })];
    const cases = calibrationCasesFrom(awards, forecasts, lines);
    expect(cases.map((c) => c.packKey)).toEqual(["oct", "nov", "nov"]);
    expect(JSON.stringify(cases)).not.toMatch(/"pilotHash"|"C"|"D"/);
  });
});
