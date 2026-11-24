import { describe, expect, it } from "vitest";
import { tripKey, type TripScore } from "@/lib/scoring-v2/trip-score";
import { rankTrips, tripRowLabel } from "@/lib/trip-rankings";
import type { BidPack, Line, Trip } from "@/types/bidpack";

const trip = (num: string, day: number): Trip => ({ id: `t-${num}`, pairingNumber: num, days: 3, startDayIndex: day, schedule: [{ legs: [] }] }) as unknown as Trip;
const line = (n: string, trips: Trip[]): Line => ({ id: `line-${n}`, lineNumber: n, trips }) as unknown as Line;
const score = (uncapped: number, capped = false): TripScore => ({ key: "", score: Math.round(uncapped * 10) / 10, uncapped, results: [], notApplicable: [], violations: capped ? [{ criterionId: "x", label: "x", value: 1, limit: 0, op: "max" }] : [] });

describe("rankTrips: every trip in the pack, best first, as the Trip Index", () => {
  const a = trip("101", 0);
  const b = trip("102", 3);
  const c = trip("103", 6);
  const d = trip("104", 9);
  const pack = { lines: [line("1001", [a, b]), line("1002", [c, d])] } as unknown as BidPack;

  it("orders trips by their own unrounded scores, and keeps the line that flies each", () => {
    const scores = new Map([[tripKey(a), score(50.04)], [tripKey(b), score(50.01)], [tripKey(c), score(60)], [tripKey(d), score(30)]]);
    const ranked = rankTrips(pack, scores);
    expect(ranked.map((t) => t.trip.pairingNumber)).toEqual(["103", "101", "102", "104"]);
    expect(ranked.map((t) => t.line.lineNumber)).toEqual(["1002", "1001", "1001", "1002"]);
    // The best trip reads in the high 90s; trips a hair apart on their own scores don't read alike.
    expect(ranked[0].score.score).toBeGreaterThanOrEqual(96);
    expect(ranked[1].score.score).toBeGreaterThan(ranked[2].score.score);
  });

  it("holds a trip that goes past a limit down, and leaves out trips with nothing to measure", () => {
    const scores = new Map([[tripKey(a), score(80, true)], [tripKey(c), score(60)], [tripKey(d), score(30)]]);
    const ranked = rankTrips(pack, scores);
    expect(ranked.map((t) => t.trip.pairingNumber)).toEqual(["103", "104", "101"]);
  });

  it("lists only the trips a non-member's lines fly, with the pack's own scores and places", () => {
    const shared = trip("105", 12);
    const both = { lines: [line("1001", [a, shared]), line("1002", [c, d, shared])] } as unknown as BidPack;
    const scores = new Map([[tripKey(a), score(50)], [tripKey(c), score(60)], [tripKey(d), score(30)], [tripKey(shared), score(40)]]);
    const all = rankTrips(both, scores);
    const mine = rankTrips(both, scores, new Set(["line-1002"]));
    expect(mine.map((t) => t.trip.pairingNumber)).toEqual(["103", "105", "104"]);
    expect(mine.map((t) => t.rank)).toEqual([1, 3, 4]);
    // A trip both lines fly is shown on the line the pilot can see, never named on one they can't.
    expect(mine.map((t) => t.line.lineNumber)).toEqual(["1002", "1002", "1002"]);
    const byKey = new Map(all.map((t) => [t.key, t.score.score]));
    for (const t of mine) expect(t.score.score).toBe(byKey.get(t.key));
  });
});

describe("tripRowLabel: a trip's row read aloud says everything the row shows", () => {
  const leg = (dep: string, arr: string, isDeadhead = false) => ({ depAirport: dep, arrAirport: arr, isDeadhead, isStandby: false });
  const t = {
    ...trip("2043", 26),
    days: 9,
    creditHours: 59 + 10 / 60,
    international: true,
    schedule: [{ legs: [leg("ANC", "NRT")] }, { legs: [leg("NRT", "HND", true)] }, { legs: [leg("HND", "ANC")] }],
  } as unknown as Trip;

  it("gives the date, length, credit, international, carry-over and route after the place and score", () => {
    expect(tripRowLabel({ rank: 3, trip: t, score: { ...score(81.7), score: 81.7 } }, "Oct 24", "48:57 C/O into November", false)).toBe(
      "#3, Trip 2043, score 81.7, Oct 24, 9-day, 59:10 credit, international, 48:57 C/O into November, ANC → NRT → DH HND → ANC — show it day by day"
    );
  });

  it("says when a limit holds the score down, and that the row is open", () => {
    const domestic = { ...t, international: false } as Trip;
    expect(tripRowLabel({ rank: 728, trip: domestic, score: { ...score(40, true), score: 29.3 } }, "Oct 12", null, true)).toBe(
      "#728, Trip 2043, score 29.3, held down by a limit you set, Oct 12, 9-day, 59:10 credit, ANC → NRT → DH HND → ANC — hide it day by day"
    );
  });
});
