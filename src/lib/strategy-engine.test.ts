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
    ...(vacationFor === i + 1 ? { vacations: [{ from: "2027-09-01T06:30:00Z", to: "2027-09-08T06:29:00Z", days: 7 }] } : {}),
  }));
  const lowest = Math.min(...SAMPLE_BID_PACK.lines.map((l) => l.totalCreditHours));
  return {
    ...SAMPLE_BID_PACK,
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

  // A pack sized like the MD11 MEM captains' (Oct 2026): 49 regular and 30 secondary lines, 10 reserve; one PAY pilot at
  // the bottom so places are counted among bidders. Odds are given, as the forecast would: every line likely open near
  // the top, eight of them in the middle of the regular lines, none at or past the last one.
  const big = (() => {
    const reg = 49, sec = 30, res = 10;
    const line = SAMPLE_BID_PACK.lines[0];
    const lines = Array.from({ length: reg }, (_, i) => ({ ...line, id: `L${i}`, lineNumber: String(1001 + i), totalCreditHours: 60 + (i % 20) }));
    const list: SeniorityEntry[] = Array.from({ length: reg + sec + res }, (_, i) => ({ bidNumber: i + 1, seniority: (i + 1) * 10 }));
    list.push({ bidNumber: list.length + 1, seniority: (list.length + 1) * 10, pay: true });
    const p = pack({ lines, seniorityList: list, info: { ...pack().info!, rlgHours: 68.5, totalRegularLines: reg, totalSecondaryLines: sec, totalReserveLines: res } });
    const odds = (bid: number) => Object.fromEntries(lines.map((l, i) => [l.id, bid <= 10 ? 0.9 : bid < reg ? (i > 40 ? 0.6 : 0.1) : 0]));
    const moves = (bid: number) => generateStrategies(p, { rank: bid, totalPilots: list.length }, null, { pAvailable: odds(bid) });
    return { reg, sec, moves };
  })();
  const card = (moves: ReturnType<typeof big.moves>, id: string) => moves.find((m) => m.id === id)!;

  it("tells a pilot late in the secondary lines how many build theirs first", () => {
    const last = card(big.moves(big.reg + big.sec), "secondary-play");
    expect(last.fitReason).not.toMatch(/still (be )?open|still there/);
    expect(last.fitReason).toContain("last of 30");
    expect(last.fitReason).toContain("29 pilots build theirs before you");
    expect(card(big.moves(big.reg + 6), "secondary-play").fitReason).toMatch(/#6 of 30 .*most of the flying is still there/);
    expect(card(big.moves(big.reg + 15), "secondary-play").fitReason).toMatch(/#15 of 30 .*much of the flying is taken/);
  });

  it("doesn't say lines likely left pay under reserve when no line is likely left", () => {
    for (const bid of [big.reg + 3, big.reg + 15, big.reg + big.sec]) {
      const moves = big.moves(bid);
      const reserve = card(moves, "reserve-pays-more");
      const leftovers = card(moves, "leftovers");
      expect(leftovers.facts.find((f) => f.label.startsWith("Regular lines likely open"))!.value).toBe("0 of 49");
      expect(reserve.fit).not.toBe("now");
      expect(reserve.fitReason).not.toContain("likely left");
      expect(reserve.fitReason).toContain("secondary line or reserve");
      expect(leftovers.tagline).not.toMatch(/About 0|best of them/);
      expect(leftovers.steps.some((s) => s.includes("the lines below"))).toBe(false);
    }
    // Inside the regular lines, the reason counts the same lines the leftovers move does.
    const mid = big.moves(30);
    expect(card(mid, "leftovers").facts.find((f) => f.label.startsWith("Regular lines likely open"))!.value).toBe("8 of 49");
    expect(card(mid, "reserve-pays-more").fitReason).toMatch(/^(All|\d+ of the) 8 regular lines likely left at your number pay/);
  });

  it("tells the last regular holder they hold the last line, not that they're 0 places inside", () => {
    const moves = big.moves(big.reg);
    expect(card(moves, "true-number").fitReason).toBe("On the numbers, you hold the last regular line.");
    expect(card(moves, "secondary-play").fitReason).toMatch(/^You hold the last regular line/);
    expect(card(moves, "leftovers").tagline).toMatch(/^No single regular line is likely still open at your number, but one will be left/);
    for (const m of moves) expect(JSON.stringify(m)).not.toMatch(/\b0 places?\b|About 0\b|\b1 regular line are\b/);
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
