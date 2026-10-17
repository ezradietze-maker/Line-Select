import { describe, expect, it } from "vitest";
import { attachScoreContext, computeStanding, generateStrategies } from "@/lib/strategy-engine";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import { buildProfile, emptyWeights } from "@/lib/preference-logic";
import { rankLines } from "@/lib/scoring";
import type { BidPack, SeniorityEntry } from "@/types/bidpack";

/**
 * A pack shaped like the real ones: 30 pilots on the list, 10 of them marked PAY, and the 20 who bid matching the pack's
 * regular + secondary + reserve lines exactly — the relationship every real pack read so far holds to.
 */
const REGULAR = SAMPLE_BID_PACK.lines.length;
const SECONDARY = 4;
const RESERVE = 20 - REGULAR - SECONDARY;
const PAY_BIDS = new Set([2, 3, 5, 8, 11, 13, 17, 21, 25, 29]);

function pack(extra: Partial<BidPack> = {}, vacationFor?: number): BidPack {
  const list: SeniorityEntry[] = Array.from({ length: 30 }, (_, i) => ({
    bidNumber: i + 1,
    seniority: (i + 1) * 10,
    ...(PAY_BIDS.has(i + 1) ? { pay: true } : {}),
    ...(vacationFor === i + 1 ? { vacations: [{ from: "2026-09-30T06:30:00Z", to: "2026-10-07T06:29:00Z", days: 7 }] } : {}),
  }));
  const lowest = Math.min(...SAMPLE_BID_PACK.lines.map((l) => l.totalCreditHours));
  return {
    ...SAMPLE_BID_PACK,
    bidPeriodStart: SAMPLE_BID_PACK.bidPeriodStart ?? "2026-09-28",
    seniorityList: list,
    info: {
      rlgHours: lowest + 1,
      rDayValueHours: 4.5,
      lowLineCreditHours: lowest,
      highLineCreditHours: lowest + 10,
      averageDaysOff: 15,
      totalRegularLines: REGULAR,
      totalSecondaryLines: SECONDARY,
      totalReserveLines: RESERVE,
      reserveReportStatus: "R-1.5",
      openTimeRelease: "19:15",
    },
    ...extra,
  };
}

const at = (bid: number) => ({ rank: bid, totalPilots: 30 });

describe("computeStanding", () => {
  it("counts only the pilots above who aren't marked PAY", () => {
    const st = computeStanding(pack(), at(12));
    expect(st.payAhead).toBe(5); // 2, 3, 5, 8, 11
    expect(st.effective).toBe(7);
    expect(st.bidders).toBe(20);
  });

  it("places the real number against the pack's regular, secondary and reserve lines", () => {
    const p = pack();
    // Bid #s whose effective place lands just past each cutoff.
    const bidAt = (effective: number) => p.seniorityList!.filter((e) => !e.pay)[effective - 1].bidNumber;
    expect(computeStanding(p, at(bidAt(REGULAR))).band).toBe("regular");
    expect(computeStanding(p, at(bidAt(REGULAR + 1))).band).toBe("secondary");
    expect(computeStanding(p, at(bidAt(REGULAR + SECONDARY + 1))).band).toBe("reserve");
    expect(computeStanding(p, at(bidAt(REGULAR + 1))).marginToRegular).toBe(-1);
  });

  it("finds the pilot's own vacation in the bid month", () => {
    const st = computeStanding(pack({}, 12), at(12));
    expect(st.vacationDays).toBeGreaterThan(0);
  });

  it("falls back to the printed number when the list has no PAY flags", () => {
    const p = pack({ seniorityList: pack().seniorityList!.map(({ bidNumber, seniority }) => ({ bidNumber, seniority })) });
    const st = computeStanding(p, at(12));
    expect(st.effective).toBeNull();
    expect(st.payAhead).toBeNull();
  });
});

describe("generateStrategies", () => {
  it("puts the moves that apply this month first, starting with the pilot's real number", () => {
    const moves = generateStrategies(pack(), at(12));
    expect(moves[0].id).toBe("true-number");
    const order = { now: 0, maybe: 1, later: 2 };
    for (let i = 1; i < moves.length; i++) expect(order[moves[i].fit]).toBeGreaterThanOrEqual(order[moves[i - 1].fit]);
    for (const m of moves) {
      expect(m.steps.length).toBeGreaterThan(0);
      expect(m.risk.length).toBeGreaterThan(0);
    }
  });

  it("makes the secondary-line move the one for a pilot past the regular cutoff", () => {
    const p = pack();
    const bid = p.seniorityList!.filter((e) => !e.pay)[REGULAR].bidNumber;
    const secondary = generateStrategies(p, at(bid)).find((m) => m.id === "secondary-play")!;
    expect(secondary.fit).toBe("now");
  });

  it("lists the regular lines that pay less than the reserve guarantee", () => {
    const reserve = generateStrategies(pack(), at(12)).find((m) => m.id === "reserve-pays-more")!;
    const rlg = pack().info!.rlgHours!;
    expect(reserve.lines.length).toBeGreaterThan(0);
    for (const l of reserve.lines) expect(l.totalCreditHours).toBeLessThan(rlg);
  });

  it("applies the vacation move only to a pilot the pack shows on vacation", () => {
    expect(generateStrategies(pack({}, 12), at(12)).find((m) => m.id === "vacation-overlap")!.fit).toBe("now");
    expect(generateStrategies(pack(), at(12)).find((m) => m.id === "vacation-overlap")!.fit).toBe("later");
  });

  it("leaves out the sweep move when no line flies a sweep aircraft", () => {
    const moves = generateStrategies(pack({ sweepFlights: [{ flightNumber: "9999", from: "ZZZ" }] }), at(12));
    expect(moves.some((m) => m.id === "sweep-flights")).toBe(false);
  });
});

describe("attachScoreContext", () => {
  it("ties a move's lines to the pilot's own scores, against their top pick", () => {
    const p = pack();
    const profile = buildProfile(emptyWeights(), false, []);
    const ranked = rankLines(p, profile);
    const moves = attachScoreContext(generateStrategies(p, at(12)), ranked);
    const withLines = moves.find((m) => m.lines.length > 0)!;
    expect(withLines.lines[0].scoreContext).not.toBeNull();
  });
});
