import { describe, expect, it } from "vitest";
import { rankLines } from "@/lib/scoring";
import type { BidPack, Line } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";

const line = (id: string, daysOff: number, credit: number): Line =>
  ({ id, lineNumber: id, trips: [], daysOff, totalCreditHours: credit, totalTafbHours: 200, totalLandings: 0, totalDepartures: 0 }) as unknown as Line;
const pack = { id: "p", month: "OCT26", base: "MEM", aircraft: "B767", seat: "FO", bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines: [line("1001", 18, 70), line("1002", 12, 85), line("1003", 15, 78)] } as unknown as BidPack;
const profile: PreferenceProfile = {
  weights: { ...DEFAULT_WEIGHTS, creditHours: 100, daysOff: -100 },
  deepRoundCompleted: false, tradeoffAnswers: [], explicitTargets: {}, isCommuter: false, hasCrashPad: null, cityPreferences: {},
  completedAt: "2026-10-10T00:00:00.000Z", implicitWeights: {}, implicitConfidence: {}, discoveredFacts: [], interviewTranscript: [],
};
const model: PilotModel = {
  version: 2, home: null, threads: [], notMeasurable: [], synopsis: "",
  criteria: [
    { id: "off", metric: "daysOff", shape: { kind: "more" }, tier: "must", weight: 1, confidence: 1, label: "Days off", evidence: [], status: "settled" },
    { id: "cap", metric: "creditHours", shape: { kind: "less" }, tier: "low", weight: 0.2, confidence: 1, label: "Less credit", evidence: [], status: "settled", hardLimit: { op: "max", value: 80 } },
  ],
};

describe("ranking by the pilot model", () => {
  it("leaves a profile without one exactly as before", () => {
    expect(rankLines(pack, profile).map((s) => s.line.lineNumber)[0]).toBe("1002");
  });

  it("orders, scores and explains every line from the model when there is one", () => {
    const ranked = rankLines(pack, { ...profile, pilotModel: model });
    expect(ranked.map((s) => s.line.lineNumber)).toEqual(["1001", "1003", "1002"]);
    expect(ranked[0].explanation).toMatch(/^Strong for you on Days off \(18 days\)/);
    expect(ranked[0].contributors[0].label).toBe("Days off (18 days)");
    expect(ranked[0].counterfactual).toBeNull();
    // 85 credit breaks the stated limit of 80.
    expect(ranked[2].violatedDealbreakers.at(-1)).toMatchObject({ label: "Less credit", detail: "85 hours — your limit is at most 80 hours" });
    expect(ranked[0].categoryScores.timeAndHomeLife.score).toBe(100);
  });
});
