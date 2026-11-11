import { describe, expect, it } from "vitest";
import { askedTripPairs, pickTripPairs, TRIP_PAIR_QUESTION, tripPairTranscript } from "@/lib/brain/trip-pairs";
import { prepareMetrics } from "@/lib/metrics/compute";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import { tripKey } from "@/lib/scoring-v2/trip-score";
import type { BidPack } from "@/types/bidpack";
import type { Criterion, PilotModel } from "@/types/pilot-model";

const crit = (id: string, metric: string, weight: number, over: Partial<Criterion> = {}): Criterion => ({ id, metric, label: id, shape: { kind: "more" }, tier: "high", weight, confidence: 0.8, evidence: [], status: "settled", ...over });
// Eight one-trip lines whose trips differ in length and credit, so each trip wins on something.
const base = SAMPLE_BID_PACK.lines[0];
const PACK: BidPack = {
  ...SAMPLE_BID_PACK,
  lines: Array.from({ length: 8 }, (_, i) => ({ ...base, id: `L${i}`, lineNumber: String(4000 + i), trips: [{ ...base.trips[0], id: `T${i}`, pairingNumber: String(10 + i), days: 2 + (i % 4), creditHours: 10 + ((i * 5) % 13) }] })),
};
const model: PilotModel = { version: 2, home: null, threads: [], notMeasurable: [], synopsis: "", criteria: [crit("More credit", "creditHours", 0.8), crit("Shorter trips", "avgTripDays", 0.7, { shape: { kind: "less" } })] };
const pm = prepareMetrics(PACK);

describe("two real trips to choose between", () => {
  const pairs = pickTripPairs(PACK, model, pm, new Set());

  it("offers trips that each win on something the pilot cares about, never two dates of one trip", () => {
    expect(pairs.length).toBeGreaterThan(0);
    const byKey = new Map(PACK.lines.flatMap((l) => l.trips).map((t) => [tripKey(t), t]));
    for (const p of pairs) {
      expect(byKey.get(p.a)!.id).not.toBe(byKey.get(p.b)!.id);
      expect(p.differences.some((d) => d.better === "a")).toBe(true);
      expect(p.differences.some((d) => d.better === "b")).toBe(true);
      expect(p.labelA).toMatch(/^Trip #/);
    }
    expect(new Set(pairs.map((p) => p.trade)).size).toBe(pairs.length);
  });

  it("records the choice so it's never offered again", () => {
    const p = pairs[0];
    const asked = tripPairTranscript("Which trip would you rather fly?", p);
    expect(TRIP_PAIR_QUESTION.test(asked)).toBe(true);
    const done = askedTripPairs([{ question: asked }]);
    expect(done.has(`${p.a}|${p.b}`) && done.has(`${p.b}|${p.a}`)).toBe(true);
    expect(pickTripPairs(PACK, model, pm, done).some((x) => x.a === p.a && x.b === p.b)).toBe(false);
  });
});
