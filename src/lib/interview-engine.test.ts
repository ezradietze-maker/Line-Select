import { describe, expect, it } from "vitest";
import { applyProfileUpdates, finalizeAdaptiveProfile } from "@/lib/interview-engine";
import type { InterviewTurnRecord, PreferenceFact, PreferenceFactUpdate } from "@/types/interview-session";

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
