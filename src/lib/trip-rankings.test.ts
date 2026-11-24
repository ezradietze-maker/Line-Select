import { describe, expect, it } from "vitest";
import { tripKey, type TripScore } from "@/lib/scoring-v2/trip-score";
import { rankTrips } from "@/lib/trip-rankings";
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
});
