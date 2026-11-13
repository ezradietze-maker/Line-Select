import { describe, expect, it } from "vitest";
import { restoreBidPack, compactBidPack } from "@/lib/bidpack-storage";
import { computeImplicitLineValues, implicitLineValuesFor } from "@/lib/implicit-dimensions";
import { runAll, warmUpTasks } from "@/lib/ranking-warm-up";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import { rankLines } from "@/lib/scoring";
import type { PilotModel } from "@/types/pilot-model";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";

const model: PilotModel = {
  version: 2,
  home: null,
  threads: [],
  notMeasurable: [],
  synopsis: "",
  criteria: [
    { id: "off", metric: "daysOff", shape: { kind: "more" }, tier: "high", weight: 1, confidence: 1, label: "Days off", evidence: [], status: "settled" },
    { id: "clock", metric: "bodyClockScore", shape: { kind: "more" }, tier: "medium", weight: 0.6, confidence: 1, label: "Body clock", evidence: [], status: "settled" },
    { id: "trips", metric: "longestTripDays", shape: { kind: "less" }, tier: "low", weight: 0.3, confidence: 1, label: "Shorter trips", evidence: [], status: "settled" },
  ],
};
const profile = (pilotModel?: PilotModel): PreferenceProfile => ({
  weights: { ...DEFAULT_WEIGHTS },
  deepRoundCompleted: false,
  tradeoffAnswers: [],
  explicitTargets: {},
  isCommuter: false,
  hasCrashPad: null,
  cityPreferences: {},
  completedAt: "2026-10-10T00:00:00.000Z",
  implicitWeights: {},
  implicitConfidence: {},
  discoveredFacts: [],
  interviewTranscript: [],
  ...(pilotModel ? { pilotModel } : {}),
});
// A pack as the app loads it: every trip its own object, as a stored pack is expanded.
const fresh = () => restoreBidPack(compactBidPack(SAMPLE_BID_PACK));
const asData = (ranked: ReturnType<typeof rankLines>) => JSON.parse(JSON.stringify(ranked.map((r) => ({ ...r, line: r.line.id }))));

describe("the ranking's warm-up", () => {
  for (const [name, p] of [["the pilot's own model", profile(model)], ["the older scoring", profile()]] as const) {
    it(`leaves the ranking exactly as it was, by ${name}`, () => {
      const cold = fresh();
      const before = asData(rankLines(cold, p, {}, computeImplicitLineValues(cold)));
      const warm = fresh();
      runAll(warmUpTasks(warm, warm, p.pilotModel, null, null));
      expect(asData(rankLines(warm, p, {}, implicitLineValuesFor(warm)))).toEqual(before);
    });
  }

  it("keeps the implicit values with the pack, the same as working them out", () => {
    const pack = fresh();
    expect(implicitLineValuesFor(pack)).toBe(implicitLineValuesFor(pack));
    expect(implicitLineValuesFor(pack)).toEqual(computeImplicitLineValues(pack));
  });
});
