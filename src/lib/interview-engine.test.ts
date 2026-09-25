import { describe, expect, it } from "vitest";
import {
  applyProfileUpdates,
  assessProfileRichness,
  deterministicFactFromAnswer,
  detectContradiction,
  EXPLICIT_WEIGHT_IDS,
  finalizeAdaptiveProfile,
  uncoveredExplicitWeightIds,
} from "@/lib/interview-engine";
import { emptyWeights } from "@/lib/preference-logic";
import type { InterviewQuestion, InterviewTurnRecord, PreferenceFact, PreferenceFactUpdate } from "@/types/interview-session";
import type { PreferenceProfile } from "@/types/preferences";

function fact(overrides: Partial<PreferenceFact> = {}): PreferenceFact {
  return {
    id: "f1",
    statement: "Prefers long trips.",
    kind: "measurable",
    measurable: { type: "explicit-weight", key: "tripLength", direction: 1 },
    confidence: 0.8,
    importance: 0.6,
    source: { kind: "adaptive-question", questionId: "q1" },
    turnIndex: 1,
    ...overrides,
  };
}

describe("applyProfileUpdates", () => {
  it("appends a new fact on 'add'", () => {
    const result = applyProfileUpdates([], [{ op: "add", fact: fact() }]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("f1");
  });

  it("replaces an existing fact by id on 'revise'", () => {
    const original = fact({ statement: "Original." });
    const revised = fact({ statement: "Revised.", confidence: 0.95 });
    const result = applyProfileUpdates([original], [{ op: "revise", fact: revised }]);
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("Revised.");
    expect(result[0].confidence).toBe(0.95);
  });

  it("appends rather than drops when 'revise' targets an id that doesn't exist yet", () => {
    const result = applyProfileUpdates([], [{ op: "revise", fact: fact() }]);
    expect(result).toHaveLength(1);
  });

  it("removes a fact by id on 'retire'", () => {
    const result = applyProfileUpdates([fact({ id: "f1" }), fact({ id: "f2" })], [
      { op: "retire", factId: "f1" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("f2");
  });

  it("applies several updates in sequence", () => {
    const updates: PreferenceFactUpdate[] = [
      { op: "add", fact: fact({ id: "f1" }) },
      { op: "add", fact: fact({ id: "f2" }) },
      { op: "retire", factId: "f1" },
      { op: "revise", fact: fact({ id: "f2", statement: "Updated." }) },
    ];
    const result = applyProfileUpdates([], updates);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("f2");
    expect(result[0].statement).toBe("Updated.");
  });

  it("does not mutate the input array", () => {
    const original: PreferenceFact[] = [fact({ id: "f1" })];
    const frozenLength = original.length;
    applyProfileUpdates(original, [{ op: "add", fact: fact({ id: "f2" }) }]);
    expect(original).toHaveLength(frozenLength);
  });
});

describe("finalizeAdaptiveProfile", () => {
  const emptyTranscript: InterviewTurnRecord[] = [];

  it("folds an explicit-weight fact into weights, scaled by importance and signed by direction", () => {
    const profile = finalizeAdaptiveProfile({
      facts: [fact({ measurable: { type: "explicit-weight", key: "tripLength", direction: 1 }, importance: 0.5 })],
      transcript: emptyTranscript,
      isCommuter: null,
      hasCrashPad: null,
    });
    expect(profile.weights.tripLength).toBe(50);
  });

  it("signs the weight negative when direction is -1", () => {
    const profile = finalizeAdaptiveProfile({
      facts: [fact({ measurable: { type: "explicit-weight", key: "tripLength", direction: -1 }, importance: 0.5 })],
      transcript: emptyTranscript,
      isCommuter: null,
      hasCrashPad: null,
    });
    expect(profile.weights.tripLength).toBe(-50);
  });

  it("floors a magnitude-only key (e.g. hotelQuiet) at 0 even when direction is -1", () => {
    const profile = finalizeAdaptiveProfile({
      facts: [fact({ measurable: { type: "explicit-weight", key: "hotelQuiet", direction: -1 }, importance: 0.9 })],
      transcript: emptyTranscript,
      isCommuter: null,
      hasCrashPad: null,
    });
    expect(profile.weights.hotelQuiet).toBe(0);
  });

  it("pins an exact explicit-target value", () => {
    const profile = finalizeAdaptiveProfile({
      facts: [fact({ measurable: { type: "explicit-target", key: "daysOff", value: 16 } })],
      transcript: emptyTranscript,
      isCommuter: null,
      hasCrashPad: null,
    });
    expect(profile.explicitTargets.daysOff).toBe(16);
  });

  it("scales an implicit-weight fact to the -1.5..1.5 range and records confidence", () => {
    const profile = finalizeAdaptiveProfile({
      facts: [
        fact({
          measurable: { type: "implicit-weight", variableId: "creditPerTafbHour", direction: 1 },
          importance: 1,
          confidence: 0.7,
        }),
      ],
      transcript: emptyTranscript,
      isCommuter: null,
      hasCrashPad: null,
    });
    expect(profile.implicitWeights.creditPerTafbHour).toBe(1.5);
    expect(profile.implicitConfidence.creditPerTafbHour).toBe(0.7);
  });

  it("sets a city sentiment", () => {
    const profile = finalizeAdaptiveProfile({
      facts: [fact({ measurable: { type: "city-sentiment", code: "SIN", sentiment: "love" } })],
      transcript: emptyTranscript,
      isCommuter: null,
      hasCrashPad: null,
    });
    expect(profile.cityPreferences.SIN).toBe("love");
  });

  it("preserves a city-sentiment seed and lets a fact add to it without clobbering it", () => {
    const profile = finalizeAdaptiveProfile({
      facts: [fact({ measurable: { type: "city-sentiment", code: "SIN", sentiment: "love" } })],
      transcript: emptyTranscript,
      isCommuter: null,
      hasCrashPad: null,
      cityPreferencesSeed: { NRT: "avoid" },
    });
    expect(profile.cityPreferences).toEqual({ NRT: "avoid", SIN: "love" });
  });

  it("does not let a qualitative fact touch weights/targets/implicitWeights", () => {
    const profile = finalizeAdaptiveProfile({
      facts: [fact({ kind: "qualitative", measurable: undefined, statement: "Values home for kids' bedtime." })],
      transcript: emptyTranscript,
      isCommuter: null,
      hasCrashPad: null,
    });
    expect(profile.weights.tripLength).toBe(0);
    expect(Object.keys(profile.explicitTargets)).toHaveLength(0);
    expect(Object.keys(profile.implicitWeights)).toHaveLength(0);
  });

  it("carries every fact, measurable and qualitative, into discoveredFacts", () => {
    const facts = [
      fact({ id: "f1", kind: "measurable" }),
      fact({ id: "f2", kind: "qualitative", measurable: undefined }),
    ];
    const profile = finalizeAdaptiveProfile({ facts, transcript: emptyTranscript, isCommuter: null, hasCrashPad: null });
    expect(profile.discoveredFacts.map((f) => f.id).sort()).toEqual(["f1", "f2"]);
  });

  it("lets a later fact (higher turnIndex) override an earlier one on the same key", () => {
    const facts = [
      fact({ id: "f1", turnIndex: 1, measurable: { type: "explicit-weight", key: "tripLength", direction: 1 }, importance: 0.9 }),
      fact({ id: "f2", turnIndex: 2, measurable: { type: "explicit-weight", key: "tripLength", direction: -1 }, importance: 0.3 }),
    ];
    const profile = finalizeAdaptiveProfile({ facts, transcript: emptyTranscript, isCommuter: null, hasCrashPad: null });
    expect(profile.weights.tripLength).toBe(-30);
  });

  it("threads isCommuter, hasCrashPad, and the transcript straight through", () => {
    const transcript: InterviewTurnRecord[] = [
      {
        turnIndex: 0,
        question: { id: "q1", kind: "free-text", prompt: "Why?" },
        answer: { kind: "free-text", text: "Because." },
        profileFactIdsTouched: [],
      },
    ];
    const profile = finalizeAdaptiveProfile({
      facts: [],
      transcript,
      isCommuter: true,
      hasCrashPad: false,
    });
    expect(profile.isCommuter).toBe(true);
    expect(profile.hasCrashPad).toBe(false);
    expect(profile.interviewTranscript).toBe(transcript);
  });
});

describe("deterministicFactFromAnswer", () => {
  const sliderQuestion: InterviewQuestion = {
    id: "q1",
    kind: "slider",
    prompt: "Pay or lifestyle?",
    lowLabel: "Lifestyle — leaner credit, easier line",
    highLabel: "Pay — maximize credit hours",
    centerLabel: "Balanced",
    boundTo: "creditHours",
  };

  const targetQuestion: InterviewQuestion = {
    id: "q2",
    kind: "target-slider",
    prompt: "Ideal credit for the month?",
    unitSingular: "hour",
    unitPlural: "hours",
    boundTo: "creditHours",
  };

  it("derives a positive-direction explicit-weight fact from a positive slider answer, regardless of what an LLM might have inferred from the surrounding conversation", () => {
    const result = deterministicFactFromAnswer(sliderQuestion, { kind: "slider", value: 10 }, 3);
    expect(result?.measurable).toEqual({ type: "explicit-weight", key: "creditHours", direction: 1 });
    expect(result?.importance).toBeCloseTo(0.1, 5);
    expect(result?.confidence).toBe(1);
  });

  it("derives a negative-direction fact from a negative slider answer — this is the exact case a live transcript run got backwards when left to the model", () => {
    const result = deterministicFactFromAnswer(sliderQuestion, { kind: "slider", value: -40 }, 3);
    expect(result?.measurable).toEqual({ type: "explicit-weight", key: "creditHours", direction: -1 });
    expect(result?.importance).toBeCloseTo(0.4, 5);
  });

  it("returns null for a slider left at 0 (no strong preference, nothing to score)", () => {
    expect(deterministicFactFromAnswer(sliderQuestion, { kind: "slider", value: 0 }, 3)).toBeNull();
  });

  it("derives an explicit-target fact from a target-slider answer", () => {
    const result = deterministicFactFromAnswer(targetQuestion, { kind: "target-slider", value: 68 }, 5);
    expect(result?.measurable).toEqual({ type: "explicit-target", key: "creditHours", value: 68 });
    expect(result?.importance).toBe(0.7);
  });

  it("returns null when a target-slider was left unset", () => {
    expect(deterministicFactFromAnswer(targetQuestion, { kind: "target-slider", value: undefined }, 5)).toBeNull();
  });

  it("returns null for choice/free-text answers — direction there has no numeric ground truth and stays the model's job", () => {
    const choiceQuestion: InterviewQuestion = { id: "q3", kind: "choice", prompt: "Pick one", options: [{ label: "A" }, { label: "B" }] };
    expect(deterministicFactFromAnswer(choiceQuestion, { kind: "choice", selectedIndex: 0 }, 3)).toBeNull();
  });

  it("wins over a conflicting same-turn model-extracted fact once applied through applyProfileUpdates + finalizeAdaptiveProfile, by being appended after it", () => {
    const modelFact = fact({
      id: "model-fact",
      measurable: { type: "explicit-weight", key: "creditHours", direction: 1 },
      importance: 0.5,
      turnIndex: 3,
    });
    const deterministic = deterministicFactFromAnswer(sliderQuestion, { kind: "slider", value: -40 }, 3)!;
    const facts = applyProfileUpdates([], [
      { op: "add", fact: modelFact },
      { op: "add", fact: deterministic },
    ]);
    const profile = finalizeAdaptiveProfile({ facts, transcript: [], isCommuter: null, hasCrashPad: null });
    expect(profile.weights.creditHours).toBeLessThan(0);
  });
});

function priorProfileWithFacts(discoveredFacts: PreferenceFact[]): PreferenceProfile {
  return {
    weights: emptyWeights(),
    deepRoundCompleted: true,
    tradeoffAnswers: [],
    explicitTargets: {},
    isCommuter: null,
    cityPreferences: {},
    hasCrashPad: null,
    completedAt: "2026-01-01T00:00:00.000Z",
    implicitWeights: {},
    implicitConfidence: {},
    discoveredFacts,
    interviewTranscript: [],
  };
}

describe("detectContradiction", () => {
  it("flags an opposite-direction explicit-weight fact on the same key", () => {
    const prior = [fact({ measurable: { type: "explicit-weight", key: "creditHours", direction: 1 }, statement: "Wants pay." })];
    const newFact = fact({ measurable: { type: "explicit-weight", key: "creditHours", direction: -1 }, statement: "Wants lifestyle." });
    const flag = detectContradiction(newFact, prior);
    expect(flag).toEqual({ newStatement: "Wants lifestyle.", priorStatement: "Wants pay." });
  });

  it("does not flag agreement on the same key", () => {
    const prior = [fact({ measurable: { type: "explicit-weight", key: "creditHours", direction: 1 } })];
    const newFact = fact({ measurable: { type: "explicit-weight", key: "creditHours", direction: 1 } });
    expect(detectContradiction(newFact, prior)).toBeNull();
  });

  it("flags a reversed city sentiment for the same city", () => {
    const prior = [fact({ measurable: { type: "city-sentiment", code: "CDG", sentiment: "avoid" }, statement: "Avoids CDG." })];
    const newFact = fact({ measurable: { type: "city-sentiment", code: "CDG", sentiment: "love" }, statement: "Loves CDG now." });
    expect(detectContradiction(newFact, prior)).toEqual({ newStatement: "Loves CDG now.", priorStatement: "Avoids CDG." });
  });

  it("flags a materially different pinned explicit-target value at the same rangeRole", () => {
    const prior = [fact({ measurable: { type: "explicit-target", key: "daysOff", value: 24 }, statement: "Wanted 24 days off." })];
    const newFact = fact({ measurable: { type: "explicit-target", key: "daysOff", value: 16 }, statement: "Now wants 16 days off." });
    expect(detectContradiction(newFact, prior)).not.toBeNull();
  });

  it("does not flag a trivial drift on a pinned explicit-target value", () => {
    const prior = [fact({ measurable: { type: "explicit-target", key: "daysOff", value: 20 } })];
    const newFact = fact({ measurable: { type: "explicit-target", key: "daysOff", value: 21 } });
    expect(detectContradiction(newFact, prior)).toBeNull();
  });

  it("does not flag a floor against a ceiling on the same key (different rangeRole = different slot)", () => {
    const prior = [fact({ measurable: { type: "explicit-target", key: "daysOff", value: 18, rangeRole: "min" } })];
    const newFact = fact({ measurable: { type: "explicit-target", key: "daysOff", value: 24, rangeRole: "max" } });
    expect(detectContradiction(newFact, prior)).toBeNull();
  });

  it("returns null when there's no prior fact on the same binding at all", () => {
    const newFact = fact({ measurable: { type: "explicit-weight", key: "international", direction: 1 } });
    expect(detectContradiction(newFact, [])).toBeNull();
  });

  it("never flags a qualitative fact — prose contradiction is left to the model, not diffed here", () => {
    const newFact = fact({ kind: "qualitative", measurable: undefined, statement: "Something new." });
    const prior = [fact({ kind: "qualitative", measurable: undefined, statement: "Something old." })];
    expect(detectContradiction(newFact, prior)).toBeNull();
  });
});

describe("finalizeAdaptiveProfile — cross-cycle history", () => {
  it("starts a fresh cycleHistory (count 1, no reaffirmation) for a fact with nothing to match in the prior profile", () => {
    const prior = priorProfileWithFacts([]);
    const profile = finalizeAdaptiveProfile({
      facts: [fact({ measurable: { type: "explicit-weight", key: "tripLength", direction: 1 } })],
      transcript: [],
      isCommuter: null,
      hasCrashPad: null,
      priorProfile: prior,
    });
    expect(profile.discoveredFacts[0].cycleHistory).toEqual({
      cycleCount: 1,
      lastCycleId: profile.completedAt,
      reaffirmedCount: 0,
    });
    expect(profile.discoveredFacts[0].volatile).toBeUndefined();
  });

  it("increments reaffirmedCount when this cycle's binding agrees with the prior cycle's", () => {
    const prior = priorProfileWithFacts([
      fact({
        measurable: { type: "explicit-weight", key: "tripLength", direction: 1 },
        cycleHistory: { cycleCount: 2, lastCycleId: "2025-12-01T00:00:00.000Z", reaffirmedCount: 1 },
      }),
    ]);
    const profile = finalizeAdaptiveProfile({
      facts: [fact({ measurable: { type: "explicit-weight", key: "tripLength", direction: 1 } })],
      transcript: [],
      isCommuter: null,
      hasCrashPad: null,
      priorProfile: prior,
    });
    expect(profile.discoveredFacts[0].cycleHistory).toEqual({
      cycleCount: 3,
      lastCycleId: profile.completedAt,
      reaffirmedCount: 2,
    });
  });

  it("resets reaffirmedCount to 0 and marks volatile when this cycle's binding disagrees with the prior cycle's", () => {
    const prior = priorProfileWithFacts([
      fact({
        measurable: { type: "explicit-weight", key: "tripLength", direction: 1 },
        cycleHistory: { cycleCount: 2, lastCycleId: "2025-12-01T00:00:00.000Z", reaffirmedCount: 1 },
      }),
    ]);
    const profile = finalizeAdaptiveProfile({
      facts: [fact({ measurable: { type: "explicit-weight", key: "tripLength", direction: -1 } })],
      transcript: [],
      isCommuter: null,
      hasCrashPad: null,
      priorProfile: prior,
    });
    expect(profile.discoveredFacts[0].cycleHistory?.reaffirmedCount).toBe(0);
    expect(profile.discoveredFacts[0].volatile).toBe(true);
  });

  it("bumps confidence to a real floor once a binding has been reaffirmed twice or more, without lowering an already-higher confidence", () => {
    const prior = priorProfileWithFacts([
      fact({
        measurable: { type: "explicit-weight", key: "tripLength", direction: 1 },
        cycleHistory: { cycleCount: 3, lastCycleId: "x", reaffirmedCount: 2 },
      }),
    ]);
    const lowConfidence = finalizeAdaptiveProfile({
      facts: [fact({ measurable: { type: "explicit-weight", key: "tripLength", direction: 1 }, confidence: 0.4 })],
      transcript: [],
      isCommuter: null,
      hasCrashPad: null,
      priorProfile: prior,
    });
    expect(lowConfidence.discoveredFacts[0].confidence).toBeGreaterThanOrEqual(0.9);

    const alreadyHighConfidence = finalizeAdaptiveProfile({
      facts: [fact({ measurable: { type: "explicit-weight", key: "tripLength", direction: 1 }, confidence: 0.99 })],
      transcript: [],
      isCommuter: null,
      hasCrashPad: null,
      priorProfile: prior,
    });
    expect(alreadyHighConfidence.discoveredFacts[0].confidence).toBe(0.99);
  });

  it("leaves cycleHistory/volatile entirely absent with no priorProfile — unchanged, first-time-interview behavior", () => {
    const profile = finalizeAdaptiveProfile({
      facts: [fact()],
      transcript: [],
      isCommuter: null,
      hasCrashPad: null,
    });
    expect(profile.discoveredFacts[0].cycleHistory).toBeUndefined();
    expect(profile.discoveredFacts[0].volatile).toBeUndefined();
  });
});

describe("assessProfileRichness", () => {
  function profileWithFacts(discoveredFacts: PreferenceFact[]): PreferenceProfile {
    return priorProfileWithFacts(discoveredFacts);
  }

  it("rates a profile with almost no measurable facts as thin", () => {
    const richness = assessProfileRichness(profileWithFacts([fact({ measurable: { type: "explicit-weight", key: "tripLength", direction: 1 } })]));
    expect(richness.level).toBe("thin");
  });

  it("rates a profile touching a broad, confident spread of real dimensions as thorough", () => {
    const keys: Array<[string, 1 | -1]> = [
      ["daysOff", 1], ["tripLength", 1], ["international", 1], ["reportTime", 1],
      ["creditHours", 1], ["deadheadTolerance", 1], ["circadianHealth", 1],
      ["landings", 1], ["departures", 1],
    ];
    const facts = keys.map(([key, direction]) =>
      fact({ id: key, measurable: { type: "explicit-weight", key: key as never, direction }, confidence: 0.9 })
    );
    const richness = assessProfileRichness(profileWithFacts(facts));
    expect(richness.level).toBe("thorough");
  });

  it("lists a backlog topic with a real dimension hint as uncovered when nothing touches it", () => {
    const richness = assessProfileRichness(profileWithFacts([]));
    expect(richness.uncoveredTopics).toContain("Landings / currency preference");
  });

  it("does not list a topic as uncovered once its hinted dimension is touched", () => {
    const richness = assessProfileRichness(
      profileWithFacts([fact({ measurable: { type: "explicit-weight", key: "landings", direction: 1 } })])
    );
    expect(richness.uncoveredTopics).not.toContain("Landings / currency preference");
  });
});

/**
 * Regression coverage for a real live-usage failure: a rich, engaged
 * 14-turn interview wrapped up having never touched 9 of the 15
 * explicit-weight ids (trip length, hotel food/gym/grocery, the generic
 * circadian-health slider, both Strategies-board inputs, and more) — this
 * is the computed gap list that closes that hole by making it a hard,
 * checkable fact each turn rather than prose the model has to remember.
 */
describe("uncoveredExplicitWeightIds", () => {
  it("lists every explicit-weight id when nothing has been touched yet", () => {
    expect(uncoveredExplicitWeightIds([])).toEqual([...EXPLICIT_WEIGHT_IDS]);
  });

  it("excludes an id once a matching explicit-weight fact exists", () => {
    const result = uncoveredExplicitWeightIds([
      fact({ measurable: { type: "explicit-weight", key: "landings", direction: -1 } }),
    ]);
    expect(result).not.toContain("landings");
    expect(result).toHaveLength(EXPLICIT_WEIGHT_IDS.length - 1);
  });

  it("is unaffected by facts that don't bind to an explicit-weight id (city-sentiment, implicit, explicit-target)", () => {
    const result = uncoveredExplicitWeightIds([
      fact({ measurable: { type: "city-sentiment", code: "LAX", sentiment: "love" } }),
      fact({ measurable: { type: "implicit-weight", variableId: "creditPerTafbHour", direction: 1 } }),
      fact({ measurable: { type: "explicit-target", key: "dutyPeriods", value: 2 } }),
    ]);
    expect(result).toEqual([...EXPLICIT_WEIGHT_IDS]);
  });

  it("returns empty once every explicit-weight id has real coverage", () => {
    const facts = EXPLICIT_WEIGHT_IDS.map((key) =>
      fact({ id: key, measurable: { type: "explicit-weight", key: key as never, direction: 1 } })
    );
    expect(uncoveredExplicitWeightIds(facts)).toEqual([]);
  });
});
