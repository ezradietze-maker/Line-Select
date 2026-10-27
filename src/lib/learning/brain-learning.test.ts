import { describe, expect, it } from "vitest";
import { buildBrainOutcome, computeBrainModel, fleetNotes, MIN_PILOTS, parseBrainOutcome, resolveBrainCohort, type BrainOutcome } from "@/lib/learning/brain-learning";
import type { Cohort } from "@/lib/learning/cohort";
import type { PilotModel } from "@/types/pilot-model";

const cohort: Cohort = { base: "ANC", aircraft: "B777", seat: "CAP", commute: "commuter", seniority: "middle" };
const model: PilotModel = {
  version: 2, home: null, threads: [], notMeasurable: [], synopsis: "",
  criteria: [
    { id: "a", metric: "baseCommutesNeeded", shape: { kind: "less" }, tier: "high", weight: 1, confidence: 1, label: "Fewer commutes", evidence: [], status: "settled" },
    { id: "b", metric: "baseCommutesNeeded", shape: { kind: "less" }, tier: "low", weight: 0.3, confidence: 1, label: "dup", evidence: [], status: "settled", hardLimit: { op: "max", value: 6 } },
    { id: "c", metric: "creditPerDayAwayFromHome", shape: { kind: "more" }, tier: "medium", weight: 0.456, confidence: 1, label: "Pay per day", evidence: [], status: "settled" },
  ],
};
const outcome = (over: Partial<BrainOutcome> = {}): BrainOutcome =>
  buildBrainOutcome({ month: "OCT26", cohort, checkIn: false, questions: 14, choices: 4, model, cityScores: { HNL: 1, CAN: -0.5 }, review: [{ metric: "creditPerDayAwayFromHome", verdict: "less" }], ...over } as Parameters<typeof buildBrainOutcome>[0]);

describe("what the fleet learns from the story-driven interview", () => {
  it("records the shape of a pilot's model — one entry per measure, never their words", () => {
    const o = outcome();
    expect(o.criteria).toEqual([{ metric: "baseCommutesNeeded", w: 1, hard: true }, { metric: "creditPerDayAwayFromHome", w: 0.46, hard: false }]);
    expect(JSON.stringify(o)).not.toMatch(/Fewer commutes|Pay per day/);
  });

  it("only accepts a well-formed outcome with known measures and bounded values", () => {
    expect(parseBrainOutcome(outcome())).toEqual(outcome());
    const bad = { ...outcome(), criteria: [{ metric: "noSuchMetric", w: 0.5, hard: false }, { metric: "daysOff", w: 7, hard: false }], cities: { HNL: 3, "<x>": 1 } };
    expect(parseBrainOutcome(bad)).toMatchObject({ criteria: [], cities: {} });
    expect(parseBrainOutcome({ ...outcome(), v: 1 })).toBeNull();
    expect(parseBrainOutcome({ ...outcome(), cohort: { ...cohort, commute: "sometimes" } })).toBeNull();
  });

  it("says nothing until a group has enough pilots, then the most specific group that does", () => {
    const few = computeBrainModel([outcome(), outcome()], "b-1", new Date(0));
    expect(fleetNotes(resolveBrainCohort(few, cohort))).toBeNull();
    const many = computeBrainModel(Array.from({ length: MIN_PILOTS }, () => outcome()), "b-2", new Date(0));
    const resolved = resolveBrainCohort(many, cohort)!;
    expect(resolved.level).toBe("pack:ANC|B777|CAP|commuter");
    const notes = fleetNotes(resolved)!;
    expect(notes).toMatch(/From 5 commuting pilots in this same base, fleet and seat/);
    expect(notes).toMatch(/Commutes to or from base, trip by trip \[baseCommutesNeeded\] — 100% of them, typical weight 1\.00, a dealbreaker for 100%/);
    expect(notes).toMatch(/Credit per day away from home: 100% said it should count less/);
    expect(notes).toMatch(/HNL liked \(avg 1\.0, 5 pilots\); CAN disliked/);
    // A local first officer elsewhere borrows from the whole fleet once it's big enough.
    expect(resolveBrainCohort(many, { base: "MEM", aircraft: "B767", seat: "FO", commute: "local" })?.level).toBe("all");
  });
});
