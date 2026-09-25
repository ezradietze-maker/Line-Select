import { describe, expect, it } from "vitest";
import { buildLineFeatures, FEATURE_COUNT, FEATURE_NAMES } from "@/lib/forecast/features";
import { estimateDropoutRate, forecastBid, forecastPackKey, likelihoodOf, resolveBidPosition } from "@/lib/forecast/forecast";
import { estimatePopulation, fitWeightsFromRanking, PRIOR_MEAN } from "@/lib/forecast/population";
import { mulberry32 } from "@/lib/forecast/random";
import type { BidPack, Line, SeniorityEntry } from "@/types/bidpack";

/** A pack of `n` lines that differ only in days off and credit (line i has i+10 days off, and less credit the more days off it has), with `pilots` pilots on the seniority list. */
function syntheticPack(n: number, pilots: number, info?: BidPack["info"]): BidPack {
  const lines: Line[] = Array.from({ length: n }, (_, i) => ({
    id: `line-${1000 + i}`,
    lineNumber: String(1000 + i),
    trips: [],
    daysOff: 10 + i,
    totalCreditHours: 90 - i * 0.5,
    totalTafbHours: 200,
    totalLandings: 8,
    totalDepartures: 8,
  }));
  const seniorityList: SeniorityEntry[] = Array.from({ length: pilots }, (_, i) => ({ bidNumber: i + 1, seniority: (i + 1) * 3 }));
  return { id: "p", month: "OCT26", base: "MEM", aircraft: "B777", seat: "CAP", bidPeriodDays: 28, bidPeriodStart: null, lines, seniorityList, info };
}

const idsBestFirst = (pack: BidPack) => [...pack.lines].reverse().map((l) => l.id); // the pilot wants the most days off

describe("bid position", () => {
  const list: SeniorityEntry[] = [
    { bidNumber: 1, seniority: 10 },
    { bidNumber: 2, seniority: 20 },
    { bidNumber: 3, seniority: 40 },
  ];

  it("places a listed pilot exactly", () => {
    expect(resolveBidPosition(list, 20)).toEqual({ bidNumber: 2, exact: true });
  });

  it("places an unlisted seniority number by how many listed pilots are more senior, and says it's approximate", () => {
    expect(resolveBidPosition(list, 30)).toEqual({ bidNumber: 3, exact: false });
    expect(resolveBidPosition(list, 5)).toEqual({ bidNumber: 1, exact: false });
    expect(resolveBidPosition(list, 99)).toEqual({ bidNumber: 4, exact: false });
  });
});

describe("dropout estimate", () => {
  const pack = (regular: number, reserve: number, secondary: number) =>
    ({ lines: new Array(regular), info: { totalRegularLines: regular, totalReserveLines: reserve, totalSecondaryLines: secondary } }) as unknown as Pick<BidPack, "info" | "lines">;

  it("reads the gap between the list and the slots the pack offers as pilots who aren't competing", () => {
    expect(estimateDropoutRate(pack(283, 52, 135), 528)).toBeCloseTo(0.11, 2);
  });

  it("keeps it inside a sensible band, and falls back when the pack says nothing", () => {
    expect(estimateDropoutRate(pack(100, 20, 30), 100)).toBe(0.03);
    expect(estimateDropoutRate(pack(10, 1, 1), 500)).toBe(0.25);
    expect(estimateDropoutRate({ lines: [] } as unknown as Pick<BidPack, "info" | "lines">, 100)).toBe(0.08);
  });
});

describe("likelihood bands", () => {
  it("names each range", () => {
    expect([0.95, 0.6, 0.3, 0.1, 0.01].map(likelihoodOf)).toEqual(["very-likely", "likely", "possible", "long-shot", "out-of-reach"]);
  });
});

describe("forecastBid", () => {
  it("returns nothing when the pack has no seniority list", () => {
    const pack = { ...syntheticPack(20, 30), seniorityList: undefined };
    expect(forecastBid({ bidPack: pack, seniorityNumber: 3, myRanking: idsBestFirst(pack) })).toBeNull();
  });

  it("gives the pilot who bids first everything, with certainty", () => {
    const pack = syntheticPack(30, 40);
    const f = forecastBid({ bidPack: pack, seniorityNumber: 3, myRanking: idsBestFirst(pack), simulations: 100 })!;
    expect(f.myBidNumber).toBe(1);
    expect(f.pilotsAhead).toBe(0);
    expect(Object.values(f.lines).every((l) => l.pAvailable === 1)).toBe(true);
    expect(f.lines["line-1029"].pAward).toBe(1);
    expect(f.confidence).toBe("high");
    expect(f.outlook).toMatch(/bid first/i);
  });

  it("does better the more senior the pilot is", () => {
    const pack = syntheticPack(60, 90);
    const typical = (seniority: number) => forecastBid({ bidPack: pack, seniorityNumber: seniority, myRanking: idsBestFirst(pack), simulations: 200 })!.awardedRank!.typical;
    expect(typical(3 * 5)).toBeLessThan(typical(3 * 25));
    expect(typical(3 * 25)).toBeLessThan(typical(3 * 50));
  });

  it("says no regular line when more pilots bid ahead than there are lines", () => {
    const pack = syntheticPack(20, 200);
    const f = forecastBid({ bidPack: pack, seniorityNumber: 3 * 150, myRanking: idsBestFirst(pack), simulations: 100 })!;
    expect(f.pNoRegularLine).toBeGreaterThan(0.95);
    expect(f.outlook).toMatch(/reserve or secondary/i);
  });

  it("makes lines a lot of pilots want less likely to be there than lines few want", () => {
    const pack = syntheticPack(60, 90);
    const f = forecastBid({ bidPack: pack, seniorityNumber: 3 * 20, myRanking: idsBestFirst(pack), simulations: 300 })!;
    const popular = f.lines["line-1059"].pAvailable; // most days off
    const unloved = f.lines["line-1000"].pAvailable; // fewest days off
    expect(popular).toBeLessThan(unloved);
  });

  it("is the same every time it's asked the same question", () => {
    const pack = syntheticPack(40, 60);
    const ask = () => forecastBid({ bidPack: pack, seniorityNumber: 3 * 15, myRanking: idsBestFirst(pack), simulations: 150 })!;
    expect(ask().lines["line-1020"].pAvailable).toBe(ask().lines["line-1020"].pAvailable);
    expect(ask().awardedRank).toEqual(ask().awardedRank);
  });

  it("uses a real ranking from a pilot ahead exactly, instead of guessing at them", () => {
    const pack = syntheticPack(10, 12);
    // Pilot #1 is known to rank line 1004 first and line 1005 second.
    const f = forecastBid({
      bidPack: pack,
      seniorityNumber: 3 * 2,
      myRanking: ["line-1004", "line-1005", "line-1006"],
      known: [{ bidNumber: 1, ranking: ["1004", "1005"] }],
      simulations: 60,
    })!;
    expect(f.lines["line-1004"].pAvailable).toBe(0);
    expect(f.lines["line-1005"].pAvailable).toBe(1);
    expect(f.lines["line-1005"].pAward).toBe(1);
    expect(f.knownAhead).toBe(1);
    expect(f.confidence).toBe("high");
  });

  it("gets more certain as more of the pilots ahead have shared their rankings", () => {
    const pack = syntheticPack(30, 40);
    const my = idsBestFirst(pack);
    const knownAhead = (share: number) =>
      Array.from({ length: Math.floor(19 * share) }, (_, i) => ({ bidNumber: i + 1, ranking: [...pack.lines].reverse().map((l) => l.lineNumber) }));
    const none = forecastBid({ bidPack: pack, seniorityNumber: 3 * 20, myRanking: my, simulations: 120 })!;
    const some = forecastBid({ bidPack: pack, seniorityNumber: 3 * 20, myRanking: my, known: knownAhead(0.5), simulations: 120 })!;
    const all = forecastBid({ bidPack: pack, seniorityNumber: 3 * 20, myRanking: my, known: knownAhead(1), simulations: 120 })!;
    expect([none.confidence, some.confidence, all.confidence]).toEqual(["low", "medium", "high"]);
    // With every pilot ahead known, the outcome is fully determined: every play gives the same award.
    expect(all.awardedRank!.best).toBe(all.awardedRank!.worst);
    expect(Math.max(...Object.values(all.lines).map((l) => l.pAward))).toBe(1);
  });
});

describe("what the forecast learns from real rankings", () => {
  it("builds one standardized column per thing a pilot can care about", () => {
    const pack = syntheticPack(30, 40);
    const f = buildLineFeatures(pack);
    expect(f.values).toHaveLength(30 * FEATURE_COUNT);
    const days = FEATURE_NAMES.indexOf("daysOff");
    let mean = 0;
    for (let i = 0; i < 30; i++) mean += f.values[i * FEATURE_COUNT + days] / 30;
    expect(Math.abs(mean)).toBeLessThan(1e-9);
  });

  it("explains a pilot's ranking from what's on the lines, leaving little unexplained", () => {
    const pack = syntheticPack(60, 80);
    const f = buildLineFeatures(pack);
    const wantsDaysOff = [...Array(60).keys()].reverse(); // line indices, most days off first
    const { residual } = fitWeightsFromRanking(f, wantsDaysOff);
    const rms = Math.sqrt(residual.reduce((s, r) => s + r * r, 0) / residual.length);
    expect(rms).toBeLessThan(0.4); // against a ranking whose own spread is 1.3
  });

  it("moves its belief about pilots toward what real pilots ranked, more the more of them there are", () => {
    const pack = syntheticPack(60, 80);
    const f = buildLineFeatures(pack);
    const days = FEATURE_NAMES.indexOf("daysOff");
    // Everyone ranks the FEWEST days off first — the opposite of the starting belief.
    const contrarian = [...Array(60).keys()];
    const few = estimatePopulation(f, Array(3).fill(contrarian));
    const many = estimatePopulation(f, Array(30).fill(contrarian));
    expect(PRIOR_MEAN[days]).toBeGreaterThan(0);
    expect(many.mean[days]).toBeLessThan(few.mean[days]);
    expect(many.mean[days]).toBeLessThan(PRIOR_MEAN[days]);
    expect(many.knownCount).toBe(30);
  });
});

describe("misc", () => {
  it("keys a pack by base, aircraft, seat and month", () => {
    expect(forecastPackKey({ month: "OCT26", base: "MEM", aircraft: "B777", seat: "CAP" })).toBe("oct26|mem|b777|cap");
  });

  it("draws the same numbers from the same seed", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
