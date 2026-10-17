import { describe, expect, it } from "vitest";
import { learnFromStrategyReaction } from "@/lib/strategy-learning";
import { DEFAULT_WEIGHTS } from "@/types/preferences";
import type { PreferenceProfile } from "@/types/preferences";

function baseProfile(overrides: Partial<PreferenceProfile> = {}): PreferenceProfile {
  return {
    weights: { ...DEFAULT_WEIGHTS },
    deepRoundCompleted: false,
    tradeoffAnswers: [],
    explicitTargets: {},
    isCommuter: null,
    hasCrashPad: null,
    cityPreferences: {},
    completedAt: "2026-01-01T00:00:00.000Z",
    implicitWeights: {},
    implicitConfidence: {},
    discoveredFacts: [],
    interviewTranscript: [],
    ...overrides,
  };
}

describe("learnFromStrategyReaction", () => {
  it("nudges riskTolerance up when a risk-favoring strategy is used", () => {
    const result = learnFromStrategyReaction(baseProfile(), "reserve-pays-more", "used");
    expect(result.weights.riskTolerance).toBeGreaterThan(0);
  });

  it("nudges riskTolerance down when a risk-favoring strategy is dismissed", () => {
    const result = learnFromStrategyReaction(baseProfile(), "reserve-pays-more", "dismissed");
    expect(result.weights.riskTolerance).toBeLessThan(0);
  });

  it("nudges riskTolerance down when using a low-risk-favoring strategy (the leftovers)", () => {
    const result = learnFromStrategyReaction(baseProfile(), "leftovers", "used");
    expect(result.weights.riskTolerance).toBeLessThan(0);
  });

  it("nudges riskTolerance up when dismissing a low-risk-favoring strategy (the leftovers)", () => {
    const result = learnFromStrategyReaction(baseProfile(), "leftovers", "dismissed");
    expect(result.weights.riskTolerance).toBeGreaterThan(0);
  });

  it("nudges adminEffortAppetite up when using an effort-favoring strategy", () => {
    const result = learnFromStrategyReaction(baseProfile(), "after-award", "used");
    expect(result.weights.adminEffortAppetite).toBeGreaterThan(0);
  });

  it("moves both traits for a strategy that reflects both (a secondary line)", () => {
    const result = learnFromStrategyReaction(baseProfile(), "secondary-play", "used");
    expect(result.weights.riskTolerance).toBeGreaterThan(0);
    expect(result.weights.adminEffortAppetite).toBeGreaterThan(0);
  });

  it("produces no updates at all for a strategy with no trait mapping (your real number)", () => {
    const result = learnFromStrategyReaction(baseProfile(), "true-number", "used");
    expect(result.updates).toHaveLength(0);
    expect(result.weights).toEqual(DEFAULT_WEIGHTS);
  });

  it("shrinks the step size as confidence in that trait builds, never a full override from one reaction", () => {
    const lowConfidence = learnFromStrategyReaction(
      baseProfile({ implicitConfidence: { riskTolerance: 0 } }),
      "reserve-pays-more",
      "used"
    );
    const highConfidence = learnFromStrategyReaction(
      baseProfile({ implicitConfidence: { riskTolerance: 0.9 } }),
      "reserve-pays-more",
      "used"
    );
    expect(highConfidence.weights.riskTolerance).toBeLessThan(lowConfidence.weights.riskTolerance);
    expect(lowConfidence.weights.riskTolerance).toBeLessThan(100);
  });

  it("clamps to -100..100 rather than overshooting after repeated reactions", () => {
    let profile = baseProfile({ weights: { ...DEFAULT_WEIGHTS, riskTolerance: 95 } });
    for (let i = 0; i < 10; i++) {
      const result = learnFromStrategyReaction(profile, "reserve-pays-more", "used");
      profile = { ...profile, weights: result.weights, implicitConfidence: result.implicitConfidence };
    }
    expect(profile.weights.riskTolerance).toBeLessThanOrEqual(100);
  });

  it("increases confidence for the affected trait after a reaction", () => {
    const result = learnFromStrategyReaction(baseProfile(), "reserve-pays-more", "used");
    expect(result.implicitConfidence.riskTolerance).toBeGreaterThan(0);
  });

  it("does not mutate the input profile's weights object", () => {
    const profile = baseProfile();
    const frozenRisk = profile.weights.riskTolerance;
    learnFromStrategyReaction(profile, "reserve-pays-more", "used");
    expect(profile.weights.riskTolerance).toBe(frozenRisk);
  });
});
